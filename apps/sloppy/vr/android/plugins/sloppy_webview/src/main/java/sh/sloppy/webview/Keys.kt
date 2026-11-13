package sh.sloppy.webview

import android.view.KeyEvent

/** The keys Godot presses on a page by name, as the DOM names them, and what a page says of its text fields. */
object Keys {
    private val codes = mapOf(
        "Enter" to KeyEvent.KEYCODE_ENTER,
        "Backspace" to KeyEvent.KEYCODE_DEL,
    )

    /** The Android key code for [name]; null for a key Godot cannot press. */
    fun code(name: String): Int? = codes[name]

    /** What a page says when a text field takes or loses focus, heard from any page. */
    fun typing(on: Boolean): String = """{"kind":"typing","on":$on}"""
}
