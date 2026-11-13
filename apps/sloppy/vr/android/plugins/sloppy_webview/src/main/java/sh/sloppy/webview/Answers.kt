package sh.sloppy.webview

import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** Questions put to Godot by request id, each answered once; an answer after its wait has ended is dropped. */
class Answers {
    private val next = AtomicInteger(1)
    private val waiting = ConcurrentHashMap<Int, ArrayBlockingQueue<Boolean>>()

    fun ask(): Int {
        val request = next.getAndIncrement()
        waiting[request] = ArrayBlockingQueue(1)
        return request
    }

    fun answer(request: Int, yes: Boolean) {
        waiting[request]?.offer(yes)
    }

    /** The answer to [request], or null where none came within [ms]. */
    fun await(request: Int, ms: Long): Boolean? =
        try {
            waiting[request]?.poll(ms, TimeUnit.MILLISECONDS)
        } finally {
            waiting.remove(request)
        }
}
