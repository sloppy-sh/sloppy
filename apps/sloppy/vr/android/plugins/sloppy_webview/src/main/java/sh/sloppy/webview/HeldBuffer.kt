package sh.sloppy.webview

import android.hardware.HardwareBuffer

/** A frame's buffer as the native pointer Godot's ExternalTexture takes, kept alive until [release]. */
internal object HeldBuffer {
    init {
        System.loadLibrary("sloppy_webview")
    }

    @JvmStatic external fun hold(buffer: HardwareBuffer): Long

    @JvmStatic external fun release(held: Long)
}
