//! The on-device graph engine: SurrealDB running natively against an on-disk
//! SurrealKV store in the app-data directory, reached from the webview over
//! three table-agnostic commands. docs/ARCHITECTURE.md § "Local-only mode".
//!
//! **This is a transport and holds no schema.** `@sloppy/data`'s repositories,
//! `schema.ts` and `purge.ts` stay in TypeScript and run unchanged against it;
//! nothing here sees a table name except as an opaque string inside a query it
//! was handed.
//!
//! One SurrealDB value has to survive the JSON hop in both directions: a record
//! id. `@sloppy/types` validates one with `z.instanceof(RecordId)`, so a bare
//! `"node:abc"` string would fail a check on a value that is correct. It is
//! tagged symmetrically as `{"$rid":[table,key]}` and revived on the way back,
//! which leaves the repositories holding exactly what the SDK would have given
//! them. Everything else Sloppy stores is plain JSON.

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
                    if pair.len() == 2 {
                        let table = pair[0].as_str().unwrap_or_default().to_string();
                        return Value::RecordId(RecordId::new(
                            table,
                            json_to_rid_key(pair[1].clone()),
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

/// Run SurrealQL and return the per-statement results array — exactly the shape
/// the SDK's `db.query()` gives, so `const [rows] = await db.query(...)` in
/// `@sloppy/data` reads the same either way.
#[tauri::command]
pub async fn db_query(sql: String, vars: JsonValue) -> Result<JsonValue, String> {
    let guard = DB.read().await;
    let db = guard.as_ref().ok_or("the on-device graph is not open")?;
    let mut resp = db
        .query(&sql)
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

/// Erase the on-device graph: drop the connection, then remove the bytes.
/// `runtime.wipeLocal` is the seam this answers.
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
