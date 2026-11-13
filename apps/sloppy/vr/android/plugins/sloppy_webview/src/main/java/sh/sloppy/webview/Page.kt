package sh.sloppy.webview

import android.annotation.SuppressLint
import android.app.Activity
import android.app.Presentation
import android.content.Context
import android.content.MutableContextWrapper
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.HardwareBuffer
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.os.Handler
import android.os.SystemClock
import android.view.InputDevice
import android.view.KeyCharacterMap
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import org.json.JSONObject

/** What a page tells the plugin; called from the UI thread, the frames thread and the page's own. */
internal interface PageSays {
    fun loaded(id: Int, url: String, title: String)

    /** Whether the page may go to [url]; asked on the UI thread, which waits for the answer. */
    fun navigating(id: Int, url: String): Boolean

    fun message(id: Int, json: String)

    fun failed(id: Int, url: String, said: String)

    fun pixels(id: Int, width: Int, height: Int, bytes: ByteArray)

    fun frame(id: Int, buffer: Long)
}

enum class Frames { PIXELS, BUFFER }

/**
 * One web view, off screen: a [WebView] in a [Presentation] on a private
 * [VirtualDisplay] whose frames land in an [ImageReader]. Everything but the
 * frames runs on the UI thread; the frames on [worker].
 */
internal class Page(
    private val activity: Activity,
    val id: Int,
    width: Int,
    height: Int,
    private val frames: Frames,
    private val worker: Handler,
    private val says: PageSays,
) {
    private val displays = activity.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
    @Volatile private var reader = newReader(width, height)
    private val display: VirtualDisplay =
        displays.createVirtualDisplay("sloppy-page-$id", width, height, DENSITY, reader.surface, 0)
    private var presentation = present()
    private val context = MutableContextWrapper(presentation.context)
    private val web = WebView(context)
    private val holder = FrameLayout(context)
    private val throttle = FrameThrottle(1000L / MOST_FRAMES_A_SECOND)
    private val kept = ArrayDeque<Pair<Image, Long>>()
    private var lastPixels: ByteArray? = null
    @Volatile private var ended = false

    @Volatile private var trusted = false
    private var htmlBase: String? = null

    @Volatile var canGoBack = false
        private set

    private var downAt = 0L
    private var lastX = width / 2f
    private var lastY = height / 2f

    init {
        dress(web)
        holder.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        presentation.setContentView(holder)
        presentation.show()
    }

    fun loadUrl(url: String) = web.loadUrl(url)

    fun loadHtml(html: String, base: String) {
        val at = base.ifEmpty { null }
        htmlBase = at ?: Trust.NO_BASE
        web.loadDataWithBaseURL(at, html, "text/html", "utf-8", at)
    }

    fun evaluate(js: String) = web.evaluateJavascript(js, null)

    fun goBack() {
        if (web.canGoBack()) web.goBack()
    }

    fun touch(x: Float, y: Float, phase: String) {
        val now = SystemClock.uptimeMillis()
        val action =
            when (phase) {
                "down" -> MotionEvent.ACTION_DOWN.also { downAt = now }
                "move" -> MotionEvent.ACTION_MOVE
                "up" -> MotionEvent.ACTION_UP
                else -> return
            }
        lastX = x
        lastY = y
        if (downAt == 0L) return
        val event = MotionEvent.obtain(downAt, now, action, x, y, 0)
        event.source = InputDevice.SOURCE_TOUCHSCREEN
        web.dispatchTouchEvent(event)
        event.recycle()
        if (action == MotionEvent.ACTION_UP) downAt = 0L
    }

    /** [dx], [dy] in pixels the content moves under the view, positive rightward and downward. */
    fun scroll(dx: Float, dy: Float) {
        val config = ViewConfiguration.get(web.context)
        val properties = MotionEvent.PointerProperties().apply {
            id = 0
            toolType = MotionEvent.TOOL_TYPE_MOUSE
        }
        val coords = MotionEvent.PointerCoords().apply {
            x = lastX
            y = lastY
            setAxisValue(MotionEvent.AXIS_VSCROLL, -dy / config.scaledVerticalScrollFactor)
            setAxisValue(MotionEvent.AXIS_HSCROLL, dx / config.scaledHorizontalScrollFactor)
        }
        val now = SystemClock.uptimeMillis()
        val event = MotionEvent.obtain(
            now, now, MotionEvent.ACTION_SCROLL, 1, arrayOf(properties), arrayOf(coords),
            0, 0, 1f, 1f, 0, 0, InputDevice.SOURCE_MOUSE, 0,
        )
        web.dispatchGenericMotionEvent(event)
        event.recycle()
    }

    fun text(typed: String) {
        val events = KeyCharacterMap.load(KeyCharacterMap.VIRTUAL_KEYBOARD).getEvents(typed.toCharArray())
        if (events == null) {
            web.evaluateJavascript("document.execCommand('insertText', false, ${JSONObject.quote(typed)})", null)
            return
        }
        for (event in events) web.dispatchKeyEvent(event)
    }

    /** [name] as [Keys] names it; a name it does not know presses nothing. */
    fun key(name: String) {
        val code = Keys.code(name) ?: return
        val now = SystemClock.uptimeMillis()
        web.dispatchKeyEvent(KeyEvent(now, now, KeyEvent.ACTION_DOWN, code, 0))
        web.dispatchKeyEvent(KeyEvent(now, now, KeyEvent.ACTION_UP, code, 0))
    }

    fun resize(width: Int, height: Int) {
        val was = reader
        reader = newReader(width, height)
        display.resize(width, height, DENSITY)
        display.surface = reader.surface
        worker.post { was.close() }
        // A presentation is dismissed when its display's size changes, so the page moves to a new one.
        val old = presentation
        holder.removeView(web)
        presentation = present()
        context.baseContext = presentation.context
        val next = FrameLayout(context)
        next.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        presentation.setContentView(next)
        presentation.show()
        old.dismiss()
    }

    fun pause() = web.onPause()

    fun resume() = web.onResume()

    fun destroy() {
        ended = true
        web.stopLoading()
        web.destroy()
        presentation.dismiss()
        display.release()
        val closing = reader
        worker.post {
            for ((image, held) in kept) {
                HeldBuffer.release(held)
                image.close()
            }
            kept.clear()
            closing.close()
        }
    }

    private fun present(): Presentation =
        Presentation(activity, display.display).apply {
            window?.setFlags(
                WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
                WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            )
        }

    private fun newReader(width: Int, height: Int): ImageReader {
        val usage =
            if (frames == Frames.BUFFER) HardwareBuffer.USAGE_GPU_SAMPLED_IMAGE else HardwareBuffer.USAGE_CPU_READ_OFTEN
        val made = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, if (frames == Frames.BUFFER) KEPT_FRAMES + 3 else 2, usage)
        made.setOnImageAvailableListener({ offered -> onFrame(offered) }, worker)
        return made
    }

    private fun onFrame(offered: ImageReader) {
        val wait = throttle.offer(SystemClock.uptimeMillis())
        when {
            wait == 0L -> send(offered)
            wait > 0L -> worker.postDelayed({
                throttle.sent(SystemClock.uptimeMillis())
                if (offered === reader) send(offered)
            }, wait)
        }
    }

    private fun send(from: ImageReader) {
        if (ended) return
        val image = try {
            from.acquireLatestImage()
        } catch (_: IllegalStateException) {
            null
        } ?: return
        if (frames == Frames.BUFFER) sendBuffer(image) else sendPixels(image)
    }

    private fun sendPixels(image: Image) {
        image.use {
            val plane = it.planes[0]
            val width = it.width
            val height = it.height
            val row = width * 4
            val bytes = ByteArray(row * height)
            val source = plane.buffer
            if (plane.rowStride == row) {
                source.get(bytes)
            } else {
                for (y in 0 until height) {
                    source.position(y * plane.rowStride)
                    source.get(bytes, y * row, row)
                }
            }
            // The display posts frames again while a page stands still; only a change is sent.
            if (bytes.contentEquals(lastPixels)) return
            lastPixels = bytes
            says.pixels(id, width, height, bytes)
        }
    }

    // Godot may still be drawing the last frames handed to it, so each one stays open two frames longer.
    private fun sendBuffer(image: Image) {
        val buffer = image.hardwareBuffer
        if (buffer == null) {
            image.close()
            return
        }
        val held = HeldBuffer.hold(buffer)
        buffer.close()
        kept.addLast(image to held)
        while (kept.size > KEPT_FRAMES) {
            val (old, oldHeld) = kept.removeFirst()
            HeldBuffer.release(oldHeld)
            old.close()
        }
        says.frame(id, held)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun dress(view: WebView) {
        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            setGeolocationEnabled(false)
            setSupportMultipleWindows(false)
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(view, false)
        view.addJavascriptInterface(Host(), "sloppy")
        view.addJavascriptInterface(Typing(), "sloppyTyping")
        view.webViewClient = Client()
        view.webChromeClient = Chrome()
    }

    private inner class Host {
        @JavascriptInterface
        fun send(json: String) {
            if (trusted) says.message(id, json)
        }
    }

    /** Heard from any page, since all it can say is whether a text field has focus. */
    private inner class Typing {
        @JavascriptInterface
        fun focus(on: Boolean) = says.message(id, Keys.typing(on))
    }

    private inner class Client : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url.toString()
            if (!request.isForMainFrame) return !Trust.webFrame(url)
            return !says.navigating(id, url)
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            trusted = Trust.ours(url, htmlBase)
        }

        override fun onPageFinished(view: WebView, url: String?) {
            canGoBack = view.canGoBack()
            says.loaded(id, url ?: "", view.title ?: "")
        }

        override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
            canGoBack = view.canGoBack()
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) says.failed(id, request.url.toString(), error.description?.toString() ?: "")
        }
    }

    private class Chrome : WebChromeClient() {
        override fun onGeolocationPermissionsShowPrompt(origin: String?, callback: GeolocationPermissions.Callback) {
            callback.invoke(origin, false, false)
        }

        override fun onPermissionRequest(request: PermissionRequest) = request.deny()
    }

    companion object {
        /** 1.5 device pixels to a CSS pixel. */
        const val DENSITY = 240
        const val MOST_FRAMES_A_SECOND = 30
        const val KEPT_FRAMES = 2
    }
}
