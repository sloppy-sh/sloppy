// A frame's HardwareBuffer as the AHardwareBuffer pointer Godot's
// ExternalTexture.set_external_buffer_id takes, held until released.
#include <jni.h>
#include <stdint.h>
#include <android/hardware_buffer_jni.h>

JNIEXPORT jlong JNICALL
Java_sh_sloppy_webview_HeldBuffer_hold(JNIEnv *env, jclass type, jobject buffer) {
    AHardwareBuffer *native = AHardwareBuffer_fromHardwareBuffer(env, buffer);
    if (native == NULL) return 0;
    AHardwareBuffer_acquire(native);
    return (jlong) (intptr_t) native;
}

JNIEXPORT void JNICALL
Java_sh_sloppy_webview_HeldBuffer_release(JNIEnv *env, jclass type, jlong held) {
    if (held != 0) AHardwareBuffer_release((AHardwareBuffer *) (intptr_t) held);
}
