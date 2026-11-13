package sh.sloppy.webview

/**
 * At most one frame every [everyMs], and never a change left unsent: a frame
 * offered too soon is sent once the interval has passed, carrying whatever
 * the page shows by then. Used from one thread.
 */
class FrameThrottle(private val everyMs: Long) {
    private var lastSent: Long? = null
    private var waiting = false

    /** 0: send now. Above 0: send in that many ms, then call [sent]. [ALREADY_WAITING]: a later send will carry it. */
    fun offer(now: Long): Long {
        if (waiting) return ALREADY_WAITING
        val last = lastSent
        val wait = if (last == null) 0 else last + everyMs - now
        if (wait <= 0) {
            lastSent = now
            return 0
        }
        waiting = true
        return wait
    }

    fun sent(now: Long) {
        waiting = false
        lastSent = now
    }

    companion object {
        const val ALREADY_WAITING = -1L
    }
}
