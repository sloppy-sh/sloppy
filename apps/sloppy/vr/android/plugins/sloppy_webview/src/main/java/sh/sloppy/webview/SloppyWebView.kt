package sh.sloppy.webview

import android.os.Handler
import android.os.HandlerThread
import org.godotengine.godot.Godot
import org.godotengine.godot.plugin.GodotPlugin
import org.godotengine.godot.plugin.SignalInfo
import org.godotengine.godot.plugin.UsedByGodot

/**
 * Web pages Godot draws on panels in the room, each by the id Godot gives it.
 * The plugin's README is the contract; apps/sloppy/vr/ui/web_panel.gd is its one user.
 */
@Suppress("FunctionName", "unused")
class SloppyWebView(godot: Godot) : GodotPlugin(godot), PageSays {
    private val pages = Views<Page>()
    private val answers = Answers()
    private val framesThread = HandlerThread("sloppy-webview-frames").apply { start() }
    private val worker = Handler(framesThread.looper)

    override fun getPluginName() = NAME

    override fun getPluginSignals(): Set<SignalInfo> = setOf(
        SignalInfo("page_loaded", INT, STRING, STRING),
        SignalInfo("navigating", INT, INT, STRING),
        SignalInfo("message", INT, STRING),
        SignalInfo("failed", INT, STRING, STRING),
        SignalInfo("pixels", INT, INT, INT, ByteArray::class.java),
        SignalInfo("frame", INT, LONG),
    )

    /** [path] is "pixels" or "buffer": how the page's frames reach Godot. */
    @UsedByGodot
    fun create(id: Int, width: Int, height: Int, path: String) {
        val frames = if (path == "buffer") Frames.BUFFER else Frames.PIXELS
        onUi { owner ->
            pages.remove(id)?.destroy()
            try {
                pages.put(id, Page(owner, id, width, height, frames, worker, this))
            } catch (refused: RuntimeException) {
                failed(id, "", refused.message ?: "")
            }
        }
    }

    @UsedByGodot
    fun destroy(id: Int) = onUi { pages.remove(id)?.destroy() }

    @UsedByGodot
    fun resize(id: Int, width: Int, height: Int) = onUi { pages[id]?.resize(width, height) }

    @UsedByGodot
    fun load_url(id: Int, url: String) = onUi { pages[id]?.loadUrl(url) }

    @UsedByGodot
    fun load_html(id: Int, html: String, base_url: String) = onUi { pages[id]?.loadHtml(html, base_url) }

    @UsedByGodot
    fun evaluate(id: Int, js: String) = onUi { pages[id]?.evaluate(js) }

    /** Whether there was a page before this one to go back to; going back happens a moment later. */
    @UsedByGodot
    fun go_back(id: Int): Boolean {
        val page = pages[id] ?: return false
        val could = page.canGoBack
        if (could) onUi { page.goBack() }
        return could
    }

    /** [phase] is "down", "move" or "up"; [x], [y] in the view's pixels from its top left. */
    @UsedByGodot
    fun touch(id: Int, x: Float, y: Float, phase: String) = onUi { pages[id]?.touch(x, y, phase) }

    @UsedByGodot
    fun scroll(id: Int, dx: Float, dy: Float) = onUi { pages[id]?.scroll(dx, dy) }

    @UsedByGodot
    fun text(id: Int, typed: String) = onUi { pages[id]?.text(typed) }

    /** The answer to a `navigating` signal's [request]. */
    @UsedByGodot
    fun allow(request: Int, yes: Boolean) = answers.answer(request, yes)

    override fun loaded(id: Int, url: String, title: String) = emitSignal("page_loaded", id, url, title)

    override fun navigating(id: Int, url: String): Boolean {
        val request = answers.ask()
        emitSignal("navigating", id, request, url)
        return answers.await(request, ANSWER_WITHIN_MS) ?: false
    }

    override fun message(id: Int, json: String) = emitSignal("message", id, json)

    override fun failed(id: Int, url: String, said: String) = emitSignal("failed", id, url, said)

    override fun pixels(id: Int, width: Int, height: Int, bytes: ByteArray) = emitSignal("pixels", id, width, height, bytes)

    override fun frame(id: Int, buffer: Long) = emitSignal("frame", id, buffer)

    override fun onMainPause() = onUi { pages.all().forEach(Page::pause) }

    override fun onMainResume() = onUi { pages.all().forEach(Page::resume) }

    override fun onMainDestroy() {
        onUi { pages.clear().forEach(Page::destroy) }
        framesThread.quitSafely()
    }

    private fun onUi(work: (android.app.Activity) -> Unit) {
        val owner = activity ?: return
        owner.runOnUiThread { work(owner) }
    }

    companion object {
        const val NAME = "SloppyWebView"

        /** Godot's main loop answers within a frame; past this the page stays where it is. */
        const val ANSWER_WITHIN_MS = 750L
        private val INT = Int::class.javaObjectType
        private val LONG = Long::class.javaObjectType
        private val STRING = String::class.java
    }
}
