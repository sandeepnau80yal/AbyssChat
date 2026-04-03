import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function RoomForm() {
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const createRoom = async () => {
    setIsLoading(true);
    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    setTimeout(() => {
      navigate(`/room/${roomCode}`);
      setIsLoading(false);
    }, 500);
  };

  const joinRoom = () => {
    const trimmedCode = code.trim().toUpperCase();
    if (trimmedCode.length >= 3) {
      navigate(`/room/${trimmedCode}`);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      joinRoom();
    }
  };

  return (
    <div className="text-center p-10 text-green-500 font-mono bg-black h-screen flex flex-col items-center overflow-hidden justify-center">
      <div className="border border-green-500 p-8 max-w-md">
        <h1 className="text-3xl mb-6 text-lime-400">AbyssChat</h1>
        <div className="text-left mb-6 text-sm text-gray-400">
          <p>&gt; Create temporary chat rooms</p>
          <p>&gt; No registration required</p>
          <p>&gt; Messages auto-delete when room is empty</p>
        </div>
        
        <div className="space-y-4">
          <button 
            onClick={createRoom} 
            className="w-full border border-green-500 px-4 py-2 hover:bg-green-500 hover:text-black transition-colors disabled:opacity-50"
            disabled={isLoading}
          >
            {isLoading ? 'Creating...' : 'CREATE NEW ROOM'}
          </button>
          
          <div className="text-gray-400">- OR -</div>
          
          <div className="space-y-2">
            <input
              className="w-full bg-black border border-green-500 px-3 py-2 text-center uppercase tracking-wider outline-none"
              placeholder="ENTER ROOM CODE"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={handleKeyDown}
              maxLength={10}
            />
            <button 
              onClick={joinRoom} 
              className="w-full border border-green-500 px-4 py-2 hover:bg-green-500 hover:text-black transition-colors disabled:opacity-50"
              disabled={!code.trim() || code.trim().length < 3}
            >
              JOIN ROOM
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
