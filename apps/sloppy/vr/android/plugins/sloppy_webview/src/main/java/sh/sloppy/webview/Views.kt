package sh.sloppy.webview

import java.util.concurrent.ConcurrentHashMap

/** The views Godot has made, by the id it gave each; read from Godot's thread, changed on the UI thread. */
class Views<T : Any> {
    private val byId = ConcurrentHashMap<Int, T>()

    /** Keeps [view] under [id]; answers the view it replaced there, which the caller ends. */
    fun put(id: Int, view: T): T? = byId.put(id, view)

    operator fun get(id: Int): T? = byId[id]

    fun remove(id: Int): T? = byId.remove(id)

    /** Every view, taken out. */
    fun clear(): List<T> {
        val all = ArrayList<T>()
        for (id in byId.keys.toList()) byId.remove(id)?.let(all::add)
        return all
    }

    fun all(): Collection<T> = byId.values

    val size: Int get() = byId.size
}
