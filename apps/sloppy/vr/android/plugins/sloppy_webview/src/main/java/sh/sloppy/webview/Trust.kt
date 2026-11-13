package sh.sloppy.webview

/** Which pages may speak to Godot through `window.sloppy.send`: ours, never a site a reader opened. */
object Trust {
    const val ASSETS = "file:///android_asset/"
    const val NO_BASE = "about:blank"

    /** Whether the page at [url] is ours, [htmlBase] being where the last `load_html` said it stands, if any. */
    fun ours(url: String?, htmlBase: String?): Boolean =
        url != null && (url.startsWith(ASSETS) || (htmlBase != null && url == htmlBase))

    /** Whether a frame inside a page may go to [url] without asking. */
    fun webFrame(url: String): Boolean {
        val scheme = url.substringBefore(':', "").lowercase()
        return scheme in setOf("http", "https", "about", "data", "blob")
    }
}
