//! Android's Wi-Fi multicast lock. Without it the radio drops the multicast
//! answers that name a desk on the network, so a headset hears none. Elsewhere
//! there is nothing to take.

#[cfg(target_os = "android")]
pub use android::MulticastLock;

#[cfg(not(target_os = "android"))]
pub struct MulticastLock;

#[cfg(not(target_os = "android"))]
impl MulticastLock {
    pub fn acquire() -> Option<Self> {
        Some(Self)
    }
}

#[cfg(target_os = "android")]
mod android {
    use std::ffi::{c_void, CStr};

    use jni::objects::{GlobalRef, JObject, JValue};
    use jni::sys::{jint, jsize, JNI_OK};
    use jni::{JNIEnv, JavaVM};

    const TAG: &str = "sloppy";

    /// Held while it lives; released when dropped.
    pub struct MulticastLock {
        vm: JavaVM,
        lock: GlobalRef,
    }

    impl MulticastLock {
        pub fn acquire() -> Option<Self> {
            let vm = created_vm()?;
            let lock = {
                let mut env = vm.attach_current_thread().ok()?;
                let lock = take(&mut env);
                settle(&mut env);
                lock?
            };
            Some(Self { vm, lock })
        }
    }

    impl Drop for MulticastLock {
        fn drop(&mut self) {
            if let Ok(mut env) = self.vm.attach_current_thread() {
                let _ = env.call_method(self.lock.as_obj(), "release", "()V", &[]);
                settle(&mut env);
            }
        }
    }

    fn take(env: &mut JNIEnv) -> Option<GlobalRef> {
        let app = env
            .call_static_method(
                "android/app/ActivityThread",
                "currentApplication",
                "()Landroid/app/Application;",
                &[],
            )
            .ok()?
            .l()
            .ok()
            .filter(|app| !app.is_null())?;
        let service = JObject::from(env.new_string("wifi").ok()?);
        let wifi = env
            .call_method(
                &app,
                "getSystemService",
                "(Ljava/lang/String;)Ljava/lang/Object;",
                &[JValue::Object(&service)],
            )
            .ok()?
            .l()
            .ok()
            .filter(|wifi| !wifi.is_null())?;
        let tag = JObject::from(env.new_string(TAG).ok()?);
        let lock = env
            .call_method(
                &wifi,
                "createMulticastLock",
                "(Ljava/lang/String;)Landroid/net/wifi/WifiManager$MulticastLock;",
                &[JValue::Object(&tag)],
            )
            .ok()?
            .l()
            .ok()?;
        env.call_method(&lock, "setReferenceCounted", "(Z)V", &[JValue::Bool(0)])
            .ok()?;
        env.call_method(&lock, "acquire", "()V", &[]).ok()?;
        env.new_global_ref(lock).ok()
    }

    /// A Java exception left pending makes every later call on this thread fail.
    fn settle(env: &mut JNIEnv) {
        if env.exception_check().unwrap_or(false) {
            let _ = env.exception_clear();
        }
    }

    type GetCreatedVms =
        unsafe extern "system" fn(*mut *mut jni::sys::JavaVM, jsize, *mut jsize) -> jint;

    /// The process's VM. Godot loads an extension without `JNI_OnLoad`, so it
    /// is asked for by name, public in libnativehelper from Android 12.
    fn created_vm() -> Option<JavaVM> {
        const LIBRARY: &CStr = c"libnativehelper.so";
        const SYMBOL: &CStr = c"JNI_GetCreatedJavaVMs";
        unsafe {
            let library = libc::dlopen(LIBRARY.as_ptr(), libc::RTLD_NOW);
            if library.is_null() {
                return None;
            }
            let symbol: *mut c_void = libc::dlsym(library, SYMBOL.as_ptr());
            if symbol.is_null() {
                return None;
            }
            let get: GetCreatedVms = std::mem::transmute(symbol);
            let mut vm: *mut jni::sys::JavaVM = std::ptr::null_mut();
            let mut count: jsize = 0;
            if get(&mut vm, 1, &mut count) != JNI_OK || count < 1 || vm.is_null() {
                return None;
            }
            JavaVM::from_raw(vm).ok()
        }
    }
}
