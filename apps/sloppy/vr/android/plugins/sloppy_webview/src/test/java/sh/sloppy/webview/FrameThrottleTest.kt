package sh.sloppy.webview

import org.junit.Assert.assertEquals
import org.junit.Test

class FrameThrottleTest {
    @Test
    fun theFirstFrameGoesAtOnce() {
        assertEquals(0L, FrameThrottle(33).offer(1_000))
    }

    @Test
    fun aFrameAfterTheIntervalGoesAtOnce() {
        val throttle = FrameThrottle(33)
        throttle.offer(1_000)
        assertEquals(0L, throttle.offer(1_033))
        assertEquals(0L, throttle.offer(1_100))
    }

    @Test
    fun aFrameTooSoonWaitsForTheRestOfTheInterval() {
        val throttle = FrameThrottle(33)
        throttle.offer(1_000)
        assertEquals(23L, throttle.offer(1_010))
    }

    @Test
    fun framesWhileOneWaitsAreCarriedByIt() {
        val throttle = FrameThrottle(33)
        throttle.offer(1_000)
        throttle.offer(1_010)
        assertEquals(FrameThrottle.ALREADY_WAITING, throttle.offer(1_020))
        assertEquals(FrameThrottle.ALREADY_WAITING, throttle.offer(1_032))
    }

    @Test
    fun aWaitingSendCountsAsTheLastOne() {
        val throttle = FrameThrottle(33)
        throttle.offer(1_000)
        throttle.offer(1_010)
        throttle.sent(1_033)
        assertEquals(13L, throttle.offer(1_053))
        throttle.sent(1_066)
        assertEquals(0L, throttle.offer(1_099))
    }

    @Test
    fun aSteadyStreamIsSentAtTheRateAndNoFaster() {
        val throttle = FrameThrottle(33)
        var sent = 0
        var dueAt = -1L
        for (now in 0L until 1_000L step 4) {
            if (dueAt in 0..now) {
                throttle.sent(now)
                sent++
                dueAt = -1
            }
            val wait = throttle.offer(now)
            if (wait == 0L) sent++ else if (wait > 0) dueAt = now + wait
        }
        assert(sent in 28..31) { "sent $sent frames in a second" }
    }
}
