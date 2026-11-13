package sh.sloppy.webview

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test

class ViewsTest {
    @Test
    fun eachIdKeepsItsOwnView() {
        val views = Views<String>()
        assertNull(views.put(1, "first"))
        assertNull(views.put(2, "second"))
        assertEquals("first", views[1])
        assertEquals("second", views[2])
        assertEquals(2, views.size)
    }

    @Test
    fun makingAViewAgainUnderAnIdHandsBackTheOneItReplaced() {
        val views = Views<String>()
        val first = "first"
        views.put(7, first)
        assertSame(first, views.put(7, "again"))
        assertEquals("again", views[7])
        assertEquals(1, views.size)
    }

    @Test
    fun endingAViewForgetsItAndEndingAnUnknownOneDoesNothing() {
        val views = Views<String>()
        views.put(3, "three")
        assertEquals("three", views.remove(3))
        assertNull(views[3])
        assertNull(views.remove(3))
        assertNull(views.remove(99))
    }

    @Test
    fun clearingHandsBackEveryView() {
        val views = Views<String>()
        views.put(1, "a")
        views.put(2, "b")
        assertEquals(setOf("a", "b"), views.clear().toSet())
        assertEquals(0, views.size)
    }
}
