'use client';

import { useState } from 'react';
import useRoomStore from '../store/useRoomStore';

export default function QAPanel({ socket, webinarId }) {
  const [question, setQuestion] = useState('');
  const { qaQuestions, role } = useRoomStore();

  const submitQuestion = () => {
    if (!question.trim() || !socket) return;
    socket.emit('sendQA', { webinarId, question: question.trim() });
    setQuestion('');
  };

  const upvote = (questionId) => socket?.emit('upvoteQA', { webinarId, questionId });

  const markAnswered = (questionId) =>
    socket?.emit('answerQA', { webinarId, questionId });

  const sorted = [...qaQuestions].sort((a, b) => b.upvotes - a.upvotes);
  const isHost = role === 'host' || role === 'panelist';

  return (
    <div className="flex flex-col h-full bg-gray-900">
      <div className="px-4 py-3 border-b border-gray-700">
        <h3 className="text-white font-semibold text-sm">
          Q&amp;A
          {sorted.length > 0 && (
            <span className="ml-2 text-xs bg-blue-600 text-white px-1.5 py-0.5 rounded-full">
              {sorted.length}
            </span>
          )}
        </h3>
        {isHost && (
          <p className="text-gray-500 text-xs mt-0.5">
            Attendees ask — you can mark as answered
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {sorted.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 text-center px-4">
            <span className="text-2xl mb-2">🙋</span>
            <p className="text-gray-400 text-sm">No questions yet</p>
            <p className="text-gray-600 text-xs mt-1">
              {isHost ? 'Attendees can ask questions below' : 'Be the first to ask!'}
            </p>
          </div>
        )}

        {sorted.map((qa) => (
          <div
            key={qa.id}
            className={`rounded-lg p-3 text-sm transition-opacity ${
              qa.answered ? 'bg-gray-800/50 opacity-60' : 'bg-gray-800'
            }`}
          >
            <p className="text-gray-200 mb-1 leading-snug">{qa.question}</p>
            <p className="text-gray-500 text-xs mb-2">— {qa.userName}</p>

            <div className="flex items-center gap-2">
              <button
                onClick={() => upvote(qa.id)}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-blue-400 transition-colors bg-gray-700/50 px-2 py-1 rounded"
              >
                ▲ {qa.upvotes}
              </button>

              {qa.answered && (
                <span className="text-xs text-green-400 bg-green-900/30 px-2 py-0.5 rounded-full">
                  ✓ Answered
                </span>
              )}

              {isHost && !qa.answered && (
                <button
                  onClick={() => markAnswered(qa.id)}
                  className="ml-auto text-xs text-yellow-400 hover:text-yellow-300 bg-yellow-900/20 hover:bg-yellow-900/40 px-2 py-0.5 rounded transition-colors"
                >
                  Mark answered
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Input — visible for attendees and hosts alike */}
      <div className="px-3 py-3 border-t border-gray-700 flex gap-2">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submitQuestion()}
          placeholder={isHost ? 'Post a question...' : 'Ask a question...'}
          className="flex-1 bg-gray-800 text-white text-sm px-3 py-2 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-gray-500"
        />
        <button
          onClick={submitQuestion}
          disabled={!question.trim()}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white px-3 py-2 rounded text-sm transition-colors"
        >
          Ask
        </button>
      </div>
    </div>
  );
}
