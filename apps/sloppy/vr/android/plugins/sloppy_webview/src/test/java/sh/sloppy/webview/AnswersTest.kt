package sh.sloppy.webview

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test
import kotlin.concurrent.thread

class AnswersTest {
    @Test
    fun everyQuestionHasItsOwnRequest() {
        val answers = Answers()
        assertNotEquals(answers.ask(), answers.ask())
    }

    @Test
    fun anAnswerGivenBeforeTheWaitIsKept() {
        val answers = Answers()
        val request = answers.ask()
        answers.answer(request, true)
        assertEquals(true, answers.await(request, 10))
    }

    @Test
    fun anAnswerFromAnotherThreadEndsTheWait() {
        val answers = Answers()
        val request = answers.ask()
        thread {
            Thread.sleep(20)
            answers.answer(request, false)
        }
        assertEquals(false, answers.await(request, 2_000))
    }

    @Test
    fun noAnswerInTimeIsNone() {
        val answers = Answers()
        assertNull(answers.await(answers.ask(), 10))
    }

    @Test
    fun aLateAnswerIsDroppedAndAnswersNothingElse() {
        val answers = Answers()
        val first = answers.ask()
        answers.await(first, 1)
        answers.answer(first, true)
        val second = answers.ask()
        answers.answer(first, true)
        assertNull(answers.await(second, 10))
        assertNull(answers.await(first, 1))
    }

    @Test
    fun anUnknownRequestIsIgnored() {
        Answers().answer(12345, true)
    }
}
