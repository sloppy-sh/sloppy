package sh.sloppy.webview

import android.app.Activity
import android.os.Handler
import android.os.HandlerThread
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

class Host : Activity()

/** A page drawn off screen on a real Android WebView, on an emulator with its network off. */
@RunWith(AndroidJUnit4::class)
class PageTest {
    private lateinit var scenario: ActivityScenario<Host>
    private val framesThread = HandlerThread("frames").apply { start() }
    private val worker = Handler(framesThread.looper)
    private val heard = Heard()
    private var page: Page? = null

    @Before
    fun open() {
        scenario = ActivityScenario.launch(Host::class.java)
    }

    @After
    fun close() {
        scenario.onActivity { page?.destroy() }
        scenario.close()
        framesThread.quitSafely()
    }

    private fun make(frames: Frames, width: Int = 320, height: Int = 200) {
        scenario.onActivity { page = Page(it, 7, width, height, frames, worker, heard) }
    }

    private fun onPage(work: Page.() -> Unit) = scenario.onActivity { page!!.work() }

    @Test
    fun aPageGivenAsHtmlIsDrawnIntoPixels() {
        make(Frames.PIXELS)
        onPage { loadHtml("<body style='margin:0;background:#ff0000'></body>", "file:///android_asset/page/") }
        assertEquals("file:///android_asset/page/", heard.loaded.poll(20, TimeUnit.SECONDS)?.first)
        val red = heard.pixelsUntil(20) { it.colourAt(160, 100) == 0xff0000ff.toInt() }
        assertEquals(320, red.width)
        assertEquals(200, red.height)
        assertEquals(320 * 200 * 4, red.bytes.size)
    }

    @Test
    fun aPageStandingStillSendsNoFrames() {
        make(Frames.PIXELS)
        onPage { loadHtml("<body style='margin:0;background:#ff0000'></body>", "file:///android_asset/page/") }
        heard.pixelsUntil(20) { it.colourAt(160, 100) == 0xff0000ff.toInt() }
        Thread.sleep(1_000)
        heard.frames.clear()
        Thread.sleep(2_000)
        assertEquals(0, heard.frames.size)
    }

    @Test
    fun aResizedPageDrawsAtItsNewSizeAndKeepsItsPage() {
        make(Frames.PIXELS)
        onPage { loadHtml("<body style='margin:0;background:#ff0000'><script>addEventListener('resize',()=>sloppy.send(String(innerWidth)))</script></body>", "file:///android_asset/page/") }
        heard.pixelsUntil(20) { it.colourAt(160, 100) == 0xff0000ff.toInt() }
        onPage { resize(480, 300) }
        val wider = heard.pixelsUntil(20) { it.width == 480 && it.colourAt(400, 250) == 0xff0000ff.toInt() }
        assertEquals(300, wider.height)
        assertEquals("the same page, 480 pixels at 1.5 to a CSS pixel", "320", heard.messages.poll(20, TimeUnit.SECONDS))
    }

    @Test
    fun ourPageIsHeardAndASiteIsNot() {
        make(Frames.PIXELS)
        onPage { loadHtml("<script>sloppy.send(JSON.stringify({kind:'ready'}))</script>", "file:///android_asset/page/") }
        assertEquals("{\"kind\":\"ready\"}", heard.messages.poll(20, TimeUnit.SECONDS))
        onPage { loadHtml("<script>sloppy.send('{}')</script>", "") }
        assertEquals("{}", heard.messages.poll(20, TimeUnit.SECONDS))
        heard.allowing = true
        onPage { loadHtml("<a id=a href='https://example.invalid/'>go</a><script>document.getElementById('a').click()</script>", "") }
        assertEquals("https://example.invalid/", heard.asked.poll(20, TimeUnit.SECONDS))
        assertEquals("https://example.invalid/", heard.failed.poll(20, TimeUnit.SECONDS))
        heard.messages.clear()
        onPage { evaluate("sloppy.send('{\"from\":\"elsewhere\"}')") }
        assertEquals(null, heard.messages.poll(2, TimeUnit.SECONDS))
    }

    @Test
    fun aTapOnALinkAsksWhereItGoesAndARefusalKeepsThePage() {
        make(Frames.PIXELS)
        heard.allowing = false
        onPage {
            loadHtml(
                "<body style='margin:0'><a href='https://example.org/next' style='display:block;width:100vw;height:100vh;background:#00ff00'>next</a></body>",
                "file:///android_asset/page/",
            )
        }
        heard.loaded.poll(20, TimeUnit.SECONDS)
        heard.pixelsUntil(20) { it.colourAt(160, 100) == 0x00ff00ff }
        onPage {
            touch(160f, 100f, "down")
            touch(160f, 100f, "up")
        }
        assertEquals("https://example.org/next", heard.asked.poll(20, TimeUnit.SECONDS))
        assertEquals(null, heard.loaded.poll(2, TimeUnit.SECONDS))
    }

    @Test
    fun theStickScrollsThePageTheWayItLeans() {
        make(Frames.PIXELS)
        onPage {
            loadHtml(
                "<body style='margin:0'><div style='height:5000px'></div><script>addEventListener('scroll',()=>sloppy.send(String(scrollY)))</script></body>",
                "file:///android_asset/page/",
            )
        }
        heard.loaded.poll(20, TimeUnit.SECONDS)
        Thread.sleep(500)
        onPage { scroll(0f, 300f) }
        val down = heard.messages.poll(20, TimeUnit.SECONDS)
        assertTrue("scrolled to $down", down != null && down.toDouble() > 0)
    }

    @Test
    fun framesAsBuffersHandOverAHeldBuffer() {
        make(Frames.BUFFER)
        onPage { loadHtml("<body style='background:#0000ff'></body>", "file:///android_asset/page/") }
        val buffer = heard.buffers.poll(20, TimeUnit.SECONDS)
        assertTrue(buffer != null)
        assertNotEquals(0L, buffer)
    }

    class Frame(val width: Int, val height: Int, val bytes: ByteArray) {
        /** RGBA as one int, red in the top byte. */
        fun colourAt(x: Int, y: Int): Int {
            val at = (y * width + x) * 4
            return (bytes[at].toInt() and 0xff shl 24) or (bytes[at + 1].toInt() and 0xff shl 16) or
                (bytes[at + 2].toInt() and 0xff shl 8) or (bytes[at + 3].toInt() and 0xff)
        }
    }

    class Heard : PageSays {
        val loaded = LinkedBlockingQueue<Pair<String, String>>()
        val messages = LinkedBlockingQueue<String>()
        val asked = LinkedBlockingQueue<String>()
        val failed = LinkedBlockingQueue<String>()
        val frames = LinkedBlockingQueue<Frame>()
        val buffers = LinkedBlockingQueue<Long>()

        @Volatile var allowing = false

        override fun loaded(id: Int, url: String, title: String) {
            loaded.add(url to title)
        }

        override fun navigating(id: Int, url: String): Boolean {
            asked.add(url)
            return allowing
        }

        override fun message(id: Int, json: String) {
            messages.add(json)
        }

        override fun failed(id: Int, url: String, said: String) {
            failed.add(url)
        }

        override fun pixels(id: Int, width: Int, height: Int, bytes: ByteArray) {
            frames.add(Frame(width, height, bytes))
        }

        override fun frame(id: Int, buffer: Long) {
            buffers.add(buffer)
        }

        fun pixelsUntil(seconds: Long, wanted: (Frame) -> Boolean): Frame {
            val until = System.currentTimeMillis() + seconds * 1000
            while (System.currentTimeMillis() < until) {
                val frame = frames.poll(until - System.currentTimeMillis(), TimeUnit.MILLISECONDS) ?: break
                if (wanted(frame)) return frame
            }
            throw AssertionError("no frame drew what was wanted")
        }
    }
}
