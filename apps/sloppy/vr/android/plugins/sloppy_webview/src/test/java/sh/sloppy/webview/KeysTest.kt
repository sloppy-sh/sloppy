package sh.sloppy.webview

import android.view.KeyEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class KeysTest {
    @Test
    fun enterAndBackspaceArePressedByTheirNames() {
        assertEquals(KeyEvent.KEYCODE_ENTER, Keys.code("Enter"))
        assertEquals(KeyEvent.KEYCODE_DEL, Keys.code("Backspace"))
    }

    @Test
    fun anyOtherNameIsNoKey() {
        assertNull(Keys.code("enter"))
        assertNull(Keys.code("Escape"))
        assertNull(Keys.code(""))
    }

    @Test
    fun aPageSaysOnlyWhetherItIsTyping() {
        assertEquals("""{"kind":"typing","on":true}""", Keys.typing(true))
        assertEquals("""{"kind":"typing","on":false}""", Keys.typing(false))
    }
}
