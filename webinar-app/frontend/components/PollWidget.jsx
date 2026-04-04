'use client';

import { useState } from 'react';
import useRoomStore from '../store/useRoomStore';

export default function PollWidget({ socket, webinarId }) {
  const { polls, role } = useRoomStore();

  // Create poll form state
  const [showForm, setShowForm] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [votedPolls, setVotedPolls] = useState({});

  const addOption = () => setPollOptions([...pollOptions, '']);
  const updateOption = (i, val) => {
    const copy = [...pollOptions];
    copy[i] = val;
    setPollOptions(copy);
  };
  const removeOption = (i) => setPollOptions(pollOptions.filter((_, idx) => idx !== i));

  const createPoll = () => {
    const options = pollOptions.filter((o) => o.trim());
    if (!pollQuestion.trim() || options.length < 2) return;
    socket?.emit('createPoll', { webinarId, question: pollQuestion.trim(), options });
    setPollQuestion('');
    setPollOptions(['', '']);
    setShowForm(false);
  };

  const vote = (pollId, optionId) => {
    if (votedPolls[pollId]) return;
    socket?.emit('submitVote', { webinarId, pollId, optionId }, (res) => {
      if (res?.success) setVotedPolls((prev) => ({ ...prev, [pollId]: optionId }));
    });
  };

  return (
    <div className="flex flex-col h-full bg-gray-900 border-l border-gray-700">
      <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
        <h3 className="text-white font-semibold text-sm">Polls</h3>
        {role === 'host' && (
          <button
            onClick={() => setShowForm(!showForm)}
            className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            {showForm ? 'Cancel' : '+ New Poll'}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-4">
        {/* Create poll form */}
        {showForm && role === 'host' && (
          <div className="bg-gray-800 rounded p-3 space-y-2">
            <input
              type="text"
              value={pollQuestion}
              onChange={(e) => setPollQuestion(e.target.value)}
              placeholder="Poll question..."
              className="w-full bg-gray-700 text-white text-sm px-3 py-2 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-gray-500"
            />
            {pollOptions.map((opt, i) => (
              <div key={i} className="flex gap-2">
                <input
                  type="text"
                  value={opt}
                  onChange={(e) => updateOption(i, e.target.value)}
                  placeholder={`Option ${i + 1}`}
                  className="flex-1 bg-gray-700 text-white text-sm px-3 py-1.5 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-gray-500"
                />
                {pollOptions.length > 2 && (
                  <button
                    onClick={() => removeOption(i)}
                    className="text-red-400 hover:text-red-300 text-xs px-1"
                  >
                    x
                  </button>
                )}
              </div>
            ))}
            <div className="flex gap-2">
              <button
                onClick={addOption}
                className="text-xs text-gray-400 hover:text-gray-300"
              >
                + Add option
              </button>
              <button
                onClick={createPoll}
                className="ml-auto bg-blue-600 hover:bg-blue-500 text-white text-xs px-3 py-1.5 rounded transition-colors"
              >
                Launch Poll
              </button>
            </div>
          </div>
        )}

        {polls.length === 0 && !showForm && (
          <p className="text-gray-500 text-xs text-center mt-4">No polls yet</p>
        )}

        {polls.map((poll) => {
          const totalVotes = poll.options.reduce((sum, o) => sum + o.votes, 0);
          const hasVoted = !!votedPolls[poll.id];

          return (
            <div key={poll.id} className="bg-gray-800 rounded p-3">
              <p className="text-white text-sm font-medium mb-3">{poll.question}</p>
              <div className="space-y-2">
                {poll.options.map((opt) => {
                  const pct = totalVotes > 0 ? Math.round((opt.votes / totalVotes) * 100) : 0;
                  return (
                    <div key={opt.id}>
                      <button
                        onClick={() => !hasVoted && vote(poll.id, opt.id)}
                        disabled={hasVoted}
                        className={`w-full text-left text-sm px-3 py-2 rounded transition-colors ${
                          votedPolls[poll.id] === opt.id
                            ? 'bg-blue-600 text-white'
                            : hasVoted
                            ? 'bg-gray-700 text-gray-300 cursor-default'
                            : 'bg-gray-700 hover:bg-gray-600 text-gray-200'
                        }`}
                      >
                        {opt.text}
                      </button>
                      {(hasVoted || role === 'host') && (
                        <div className="mt-1 flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-gray-700 rounded overflow-hidden">
                            <div
                              className="h-full bg-blue-500 rounded transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-400">{pct}%</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-gray-500 text-xs mt-2">{totalVotes} votes</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
