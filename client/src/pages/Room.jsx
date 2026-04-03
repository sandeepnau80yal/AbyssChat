import { useParams, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import TerminalUI from '../components/TerminalUI';

export default function Room() {
  const { code } = useParams();
  const [username, setUsername] = useState('');
  const [entered, setEntered] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    // Validate room code
    if (!code || code.length < 3) {
      navigate('/');
    }
  }, [code, navigate]);

  const handleEnter = () => {
    const trimmedUsername = username.trim();
    
    if (!trimmedUsername) {
      setError('Username is required');
      return;
    }
    
    if (trimmedUsername.length < 2) {
      setError('Username must be at least 2 characters');
      return;
    }
    
    if (trimmedUsername.length > 20) {
      setError('Username must be less than 20 characters');
      return;
    }
    
    // Sanitize username
    const sanitizedUsername = trimmedUsername.replace(/[<>]/g, '');
    if (sanitizedUsername !== trimmedUsername) {
      setError('Username contains invalid characters');
      return;
    }
    
    setError('');
    setUsername(sanitizedUsername);
    setEntered(true);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleEnter();
    }
  };

  const handleLeave = () => {
    navigate('/');
  };

  if (entered) {
    return <TerminalUI username={username} room={code} />;
  }

  return (
    <div className="bg-black text-green-500 font-mono h-screen flex flex-col items-center justify-center p-4">
      <div className="border border-green-500 p-8 max-w-md w-full">
        <div className="text-center mb-6">
          <h2 className="text-xl text-lime-400 mb-2">JOINING ROOM</h2>
          <p className="text-gray-400">Room Code: <span className="text-green-500">{code}</span></p>
        </div>
        
        <div className="space-y-4">
          <div>
            <input
              className="w-full bg-black border border-green-500 px-3 py-2 text-center outline-none"
              placeholder="Enter your nickname"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={handleKeyDown}
              maxLength={20}
              autoFocus
            />
            {error && <p className="text-red-500 text-sm mt-1">{error}</p>}
          </div>
          
          <div className="flex space-x-2">
            <button 
              onClick={handleEnter} 
              className="flex-1 border border-green-500 px-4 py-2 hover:bg-green-500 hover:text-black transition-colors"
            >
              ENTER
            </button>
            <button 
              onClick={handleLeave} 
              className="px-4 py-2 border border-gray-500 text-gray-400 hover:border-red-500 hover:text-red-500 transition-colors"
            >
              BACK
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
