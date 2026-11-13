package sh.sloppy.webview

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TrustTest {
    @Test
    fun ourBundledPagesMaySpeak() {
        assertTrue(Trust.ours("file:///android_asset/web/dist/index.html", null))
    }

    @Test
    fun aPageGivenAsHtmlMaySpeakFromWhereItWasSaidToStand() {
        assertTrue(Trust.ours("file:///android_asset/web/dist/", "file:///android_asset/web/dist/"))
        assertTrue(Trust.ours(Trust.NO_BASE, Trust.NO_BASE))
    }

    @Test
    fun aSiteNeverSpeaks() {
        assertFalse(Trust.ours("https://example.org/", null))
        assertFalse(Trust.ours("https://example.org/", "file:///android_asset/web/dist/"))
        assertFalse(Trust.ours("file:///sdcard/page.html", null))
        assertFalse(Trust.ours(null, Trust.NO_BASE))
    }

    @Test
    fun framesInsideAPageGoOnlyToTheWeb() {
        assertTrue(Trust.webFrame("https://example.org/embed"))
        assertTrue(Trust.webFrame("HTTP://example.org/"))
        assertTrue(Trust.webFrame("about:blank"))
        assertFalse(Trust.webFrame("intent://scan#Intent;end"))
        assertFalse(Trust.webFrame("file:///data/data/sh.sloppy.vr/files/x"))
        assertFalse(Trust.webFrame("javascript:alert(1)"))
    }
}
