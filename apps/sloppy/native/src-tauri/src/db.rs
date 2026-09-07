//! The on-device graph engine: SurrealDB running natively against an on-disk
//! SurrealKV store in the app-data directory, reached from the webview over
//! three table-agnostic commands. docs/ARCHITECTURE.md § "Local-only mode".
//!
//! A transport that holds no schema: `@sloppy/data` stays in TypeScript and runs
//! unchanged against it, and nothing here sees a table name except as an opaque
//! string inside a query it was handed.
//!
//! **Wire contract.** A stored `RecordId` crosses in both directions tagged as
//! `{"$rid":[table,key]}` — a one-key object whose `$rid` is a two-element
//! array, recognised at any depth; anything that merely resembles it stays
//! data. Binding an id means writing that tag, and reading one back means
//! turning it into `@sloppy/types`' `RecordIdSchema` class, which no JSON
//! encoding does on its own.
//!
//! Nothing else is tagged, so a value JSON cannot spell — a datetime, a
//! duration, a decimal — leaves as the string the SDK renders it to and comes
//! back as that string, not as the type it was. What makes an untagged
//! transport enough is that Sloppy stores none of them: docs/ARCHITECTURE.md
//! § "Data model" rules every column to a string, a number, a bool or a
//! collection of those, timestamps included.

use serde_json::{Number as JsonNumber, Value as JsonValue};
use surrealdb::engine::local::{Db, SurrealKv};
use surrealdb::types::{Array, Number, Object, RecordId, RecordIdKey, Value, Variables};
use surrealdb::Surreal;
use tauri::{AppHandle, Manager};
use tokio::sync::RwLock;

/// One connection for the process: SurrealKV is a single on-disk store and the
/// app is one person. `None` until opened, and again after a wipe — which is
/// what lets the directory be removed and then recreated.
static DB: RwLock<Option<Surreal<Db>>> = RwLock::const_new(None);

fn store_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("graph"))
}

// ── surreal Value <-> JSON, with RecordId tagged as {"$rid":[table,key]} ─────

fn rid_key_to_json(k: RecordIdKey) -> JsonValue {
    match k {
        RecordIdKey::Number(i) => JsonValue::Number(JsonNumber::from(i)),
        RecordIdKey::String(s) => JsonValue::String(s),
        RecordIdKey::Uuid(u) => JsonValue::String(u.to_string()),
        RecordIdKey::Array(a) => {
            JsonValue::Array(a.into_inner().into_iter().map(value_to_json).collect())
        }
        RecordIdKey::Object(o) => {
            JsonValue::Object(o.into_iter().map(|(k, v)| (k, value_to_json(v))).collect())
        }
        // Query syntax, never a stored key: nothing can SELECT one back out.
        RecordIdKey::Range(_) => JsonValue::Null,
    }
}

fn value_to_json(v: Value) -> JsonValue {
    match v {
        Value::None | Value::Null => JsonValue::Null,
        Value::Bool(b) => JsonValue::Bool(b),
        Value::Number(Number::Int(i)) => JsonValue::Number(JsonNumber::from(i)),
        Value::Number(Number::Float(f)) => JsonNumber::from_f64(f)
            .map(JsonValue::Number)
            .unwrap_or(JsonValue::Null),
        Value::Number(Number::Decimal(d)) => JsonValue::String(d.to_string()),
        Value::String(s) => JsonValue::String(s),
        Value::Array(a) => {
            JsonValue::Array(a.into_inner().into_iter().map(value_to_json).collect())
        }
        Value::Object(o) => {
            JsonValue::Object(o.into_iter().map(|(k, v)| (k, value_to_json(v))).collect())
        }
        Value::RecordId(rid) => {
            let tb = JsonValue::String(rid.table.into_string());
            serde_json::json!({ "$rid": [tb, rid_key_to_json(rid.key)] })
        }
        // datetime / duration / uuid / bytes / geometry — Sloppy stores these as
        // plain JSON, so the SDK's own renderer is already the right answer.
        other => other.into_json_value(),
    }
}

fn json_to_rid_key(j: JsonValue) -> RecordIdKey {
    match j {
        JsonValue::String(s) => RecordIdKey::from(s),
        JsonValue::Number(n) => n
            .as_i64()
            .map(RecordIdKey::from)
            .unwrap_or_else(|| RecordIdKey::from(n.to_string())),
        JsonValue::Array(a) => {
            RecordIdKey::from(a.into_iter().map(json_to_value).collect::<Array>())
        }
        JsonValue::Object(o) => RecordIdKey::from(
            o.into_iter()
                .map(|(k, v)| (k, json_to_value(v)))
                .collect::<Object>(),
        ),
        other => RecordIdKey::from(other.to_string()),
    }
}

fn json_to_value(j: JsonValue) -> Value {
    match j {
        JsonValue::Null => Value::Null,
        JsonValue::Bool(b) => Value::Bool(b),
        JsonValue::Number(n) => {
            if let Some(i) = n.as_i64() {
                Value::Number(Number::Int(i))
            } else if let Some(f) = n.as_f64() {
                Value::Number(Number::Float(f))
            } else {
                Value::Null
            }
        }
        JsonValue::String(s) => Value::String(s),
        JsonValue::Array(a) => Value::Array(a.into_iter().map(json_to_value).collect()),
        JsonValue::Object(map) => {
            if map.len() == 1 {
                if let Some(JsonValue::Array(pair)) = map.get("$rid") {
                    if let [JsonValue::String(table), key] = pair.as_slice() {
                        return Value::RecordId(RecordId::new(
                            table.clone(),
                            json_to_rid_key(key.clone()),
                        ));
                    }
                }
            }
            Value::Object(
                map.into_iter()
                    .map(|(k, v)| (k, json_to_value(v)))
                    .collect(),
            )
        }
    }
}

fn vars_to_variables(vars: JsonValue) -> Variables {
    match vars {
        JsonValue::Object(map) => map
            .into_iter()
            .map(|(k, v)| (k, json_to_value(v)))
            .collect::<Variables>(),
        _ => Variables::new(),
    }
}

// ── The commands the webview reaches the store through ──────────────────────

/// Open the store and select the namespace and database. Idempotent: the
/// connection is opened once and kept for the life of the process.
#[tauri::command]
pub async fn db_open(app: AppHandle, ns: String, db: String) -> Result<(), String> {
    let mut guard = DB.write().await;
    if guard.is_none() {
        let path = store_path(&app)?;
        std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
        let handle = Surreal::new::<SurrealKv>(path.to_str().ok_or("bad app-data path")?)
            .await
            .map_err(|e| e.to_string())?;
        *guard = Some(handle);
    }
    let handle = guard.as_ref().expect("just opened");
    handle
        .use_ns(ns)
        .use_db(db)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

async fn run(db: &Surreal<Db>, sql: &str, vars: JsonValue) -> Result<JsonValue, String> {
    let mut resp = db
        .query(sql)
        .bind(vars_to_variables(vars))
        .await
        .map_err(|e| e.to_string())?
        .check()
        .map_err(|e| e.to_string())?;
    let n = resp.num_statements();
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let v: Value = resp.take(i).map_err(|e| e.to_string())?;
        out.push(value_to_json(v));
    }
    Ok(JsonValue::Array(out))
}

/// Run SurrealQL and return the per-statement results array — exactly the shape
/// the SDK's `db.query()` gives, so `const [rows] = await db.query(...)` in
/// `@sloppy/data` reads the same either way.
#[tauri::command]
pub async fn db_query(sql: String, vars: JsonValue) -> Result<JsonValue, String> {
    let guard = DB.read().await;
    let db = guard.as_ref().ok_or("the on-device graph is not open")?;
    run(db, &sql, vars).await
}

/// Erase the on-device graph: drop the connection, then remove the bytes.
#[tauri::command]
pub async fn db_wipe(app: AppHandle) -> Result<(), String> {
    let path = store_path(&app)?;
    // Dropping the handle first is what releases the store; the next db_open
    // recreates the directory.
    DB.write().await.take();
    match std::fs::remove_dir_all(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const DID: &str = "did:syr:z6MkAlice";

    fn rid(table: &str, key: JsonValue) -> JsonValue {
        json!({ "$rid": [table, key] })
    }

    async fn store() -> (Surreal<Db>, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("temp dir");
        let db = Surreal::new::<SurrealKv>(dir.path().to_str().expect("utf-8 temp path"))
            .await
            .expect("open the store");
        db.use_ns("sloppy").use_db("test").await.expect("select db");
        (db, dir)
    }

    /// The two id forms `@sloppy/data` writes together — the composite
    /// `node:{ created_by, id }` as the row's own key, and the `<did>/<ulid>`
    /// ref a column points with (docs/ARCHITECTURE.md § "Data model") — through
    /// SurrealDB and back.
    #[tokio::test(flavor = "multi_thread")]
    async fn a_composite_record_id_survives_the_store_and_the_json_hop() {
        let (db, _dir) = store().await;
        let root = rid("node", json!({ "created_by": DID, "id": "01ROOT" }));
        let child = rid("node", json!({ "created_by": DID, "id": "01CHILD" }));
        let root_ref = json!(format!("{DID}/01ROOT"));

        run(
            &db,
            "CREATE $id SET address = '1', depth = 1",
            json!({ "id": root }),
        )
        .await
        .unwrap();
        run(
            &db,
            "CREATE $id SET address = '1a', depth = 2, parent = $parent",
            json!({ "id": child, "parent": root_ref }),
        )
        .await
        .unwrap();

        let out = run(
            &db,
            "SELECT id, parent FROM node WHERE address = '1a'",
            JsonValue::Null,
        )
        .await
        .unwrap();

        assert_eq!(out[0][0]["id"], child);
        assert_eq!(out[0][0]["parent"], root_ref);
    }

    /// A bound id that no row carries still has to come back as the same id:
    /// this is the half a returned row cannot exercise.
    #[tokio::test(flavor = "multi_thread")]
    async fn every_record_id_key_shape_survives_a_bound_variable() {
        let (db, _dir) = store().await;
        for key in [
            json!("plain"),
            json!(42),
            json!(["subtree", 3]),
            json!({ "created_by": DID, "id": "01ULID" }),
        ] {
            let id = rid("node", key);
            let out = run(&db, "RETURN $id", json!({ "id": id })).await.unwrap();
            assert_eq!(out[0], id);
        }
    }

    /// `{"$rid": …}` in the agreed shape is the only object with a meaning; one
    /// that merely resembles it is data.
    #[tokio::test(flavor = "multi_thread")]
    async fn an_object_that_is_not_the_tag_stays_an_object() {
        let (db, _dir) = store().await;
        for value in [
            json!({ "$rid": "node:abc" }),
            json!({ "$rid": ["node"] }),
            json!({ "$rid": [1, 2] }),
            json!({ "$rid": ["node", "abc"], "labels": {} }),
            json!({ "dimension": "domain", "value": "biology" }),
        ] {
            let out = run(&db, "RETURN $v", json!({ "v": value })).await.unwrap();
            assert_eq!(out[0], value);
        }
    }

    /// A record id nested inside the arrays and objects a result set is made
    /// of — where nesting actually happens, since a node's own columns point
    /// with refs rather than with ids.
    #[tokio::test(flavor = "multi_thread")]
    async fn a_nested_record_id_survives() {
        let (db, _dir) = store().await;
        let value = json!({
            "rows": [{ "id": rid("node", json!({ "created_by": DID, "id": "01A" })) }],
            "deeper": { "id": rid("block", json!("01B")) }
        });
        let out = run(&db, "RETURN $v", json!({ "v": value })).await.unwrap();
        assert_eq!(out[0], value);
    }
}
