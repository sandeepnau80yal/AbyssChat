import { useEffect, useState, useRef, useCallback } from 'react';
import { socket } from '../socket';

// Encryption utility class for shared room encryption
class ChatEncryption {
  constructor() {
    this.roomKeys = new Map();
  }

  async deriveKeyFromPassword(password, roomId) {
    const encoder = new TextEncoder();
    const passwordBuffer = encoder.encode(password);
    const roomBuffer = encoder.encode(roomId);

    const salt = await crypto.subtle.digest('SHA-256', roomBuffer);

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      passwordBuffer,
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    const key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );

    this.roomKeys.set(roomId, key);
    return key;
  }

  async encryptMessage(message, roomId) {
    const key = this.roomKeys.get(roomId);
    if (!key) throw new Error('No encryption key for room');

    const encoder = new TextEncoder();
    const data = encoder.encode(message);
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const encryptedData = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      data
    );

    return {
      encrypted: Array.from(new Uint8Array(encryptedData)),
      iv: Array.from(iv)
    };
  }

  async decryptMessage(encryptedData, iv, roomId) {
    const key = this.roomKeys.get(roomId);
    if (!key) throw new Error('No decryption key for room');

    const encryptedBuffer = new Uint8Array(encryptedData).buffer;
    const ivBuffer = new Uint8Array(iv);

    try {
      const decryptedData = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: ivBuffer },
        key,
        encryptedBuffer
      );

      const decoder = new TextDecoder();
      return decoder.decode(decryptedData);
    } catch (error) {
      console.error('Decryption failed:', error);
      return '[Message could not be decrypted]';
    }
  }

  hasRoomKey(roomId) {
    return this.roomKeys.has(roomId);
  }

  clearRoomKey(roomId) {
    this.roomKeys.delete(roomId);
  }
}

// Create global encryption instance
const encryption = new ChatEncryption();

export default function TerminalUI({ username, room, roomPassword = null }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [userCount, setUserCount] = useState(0);
  const [typingUsers, setTypingUsers] = useState(new Set());
  const [showCopyFeedback, setShowCopyFeedback] = useState({ visible: false, message: '', type: '' });
  const [encryptionEnabled, setEncryptionEnabled] = useState(false);
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(true); // Always show initially
  const [passwordInput, setPasswordInput] = useState(roomPassword || '');
  const [passwordError, setPasswordError] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [joinAttempted, setJoinAttempted] = useState(false);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const textareaRef = useRef(null);
  const isMobile = useRef(false);
  const messagesContainerRef = useRef(null);

  useEffect(() => {
    isMobile.current = /Mobi|Android/i.test(navigator.userAgent);
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const isScrolledToBottom = useCallback(() => {
    if (!messagesContainerRef.current) return false;
    const { scrollHeight, scrollTop, clientHeight } = messagesContainerRef.current;
    return scrollHeight - scrollTop <= clientHeight + 20;
  }, []);

  const setupRoomEncryption = async (password) => {
    try {
      await encryption.deriveKeyFromPassword(password, room);
      setEncryptionEnabled(true);
      console.log('Room encryption enabled with password');
      return true;
    } catch (error) {
      console.error('Failed to setup encryption:', error);
      return false;
    }
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    if (!passwordInput.trim()) {
      setPasswordError('Password is required to join the room');
      return;
    }

    if (!isConnected) {
      setPasswordError('Not connected to server. Please wait...');
      return;
    }

    setIsJoining(true);
    setPasswordError('');
    
    try {
      // Setup encryption first
      const encryptionSuccess = await setupRoomEncryption(passwordInput.trim());
      if (!encryptionSuccess) {
        setPasswordError('Failed to setup encryption');
        setIsJoining(false);
        return;
      }

      // Then attempt to join room
      setJoinAttempted(true);
      console.log('Attempting to join room:', room, 'with username:', username);
      socket.emit("joinRoom", { room, username, password: passwordInput.trim() });
      
      // Set a timeout to prevent infinite joining state
      setTimeout(() => {
        if (isJoining) {
          setPasswordError('Join request timed out. Please try again.');
          setIsJoining(false);
          setJoinAttempted(false);
        }
      }, 10000); // 10 second timeout
      
    } catch (error) {
      console.error('Error in handlePasswordSubmit:', error);
      setPasswordError('An error occurred. Please try again.');
      setIsJoining(false);
      setJoinAttempted(false);
    }
  };

  const handleWrongPassword = () => {
    setShowPasswordPrompt(true);
    setPasswordError('Incorrect password. Please try again.');
    setPasswordInput('');
    setIsJoining(false);
    setJoinAttempted(false);
    encryption.clearRoomKey(room);
    setEncryptionEnabled(false);
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const lineHeight = parseFloat(getComputedStyle(textareaRef.current).lineHeight);
      const maxHeight = lineHeight * 5;
      if (textareaRef.current.scrollHeight < maxHeight) {
        textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
      } else {
        textareaRef.current.style.height = `${maxHeight}px`;
        textareaRef.current.style.overflowY = 'auto';
      }
    }
  }, [input]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (isScrolledToBottom()) {
      scrollToBottom();
    }
  }, [typingUsers, scrollToBottom, isScrolledToBottom]);

  useEffect(() => {
    // Clear messages when component mounts
    setMessages([]);
    
    // Connect to socket
    socket.connect();

    socket.on("connect", () => {
      setIsConnected(true);
      console.log('Connected to server');
    });

    socket.on("disconnect", () => {
      setIsConnected(false);
      setIsJoining(false);
      setJoinAttempted(false);
    });

    socket.on("message", async (msg) => {
      let processedMessage = { ...msg };

      // Handle encrypted messages
      if (msg.isEncrypted && msg.encrypted && msg.iv) {
        try {
          if (encryption.hasRoomKey(room)) {
            const decryptedText = await encryption.decryptMessage(msg.encrypted, msg.iv, room);
            if (decryptedText === '[Message could not be decrypted]') {
              // Wrong password - show password prompt
              handleWrongPassword();
              processedMessage = {
                ...msg,
                text: '[Encrypted message - wrong password]',
                isDecrypted: false,
                encryptionIcon: '🔒'
              };
            } else {
              processedMessage = {
                ...msg,
                text: decryptedText,
                isDecrypted: true,
                encryptionIcon: '🔓'
              };
            }
          } else {
            // No key available - show password prompt
            setShowPasswordPrompt(true);
            processedMessage = {
              ...msg,
              text: '[Encrypted message - password required]',
              isDecrypted: false,
              encryptionIcon: '🔒'
            };
          }
        } catch (error) {
          console.error('Failed to decrypt message:', error);
          processedMessage = {
            ...msg,
            text: '[Message decryption failed]',
            isDecrypted: false,
            encryptionIcon: '⚠️'
          };
        }
      }

      setMessages((prev) => [...prev, processedMessage]);
    });

    socket.on("userCount", (count) => {
      setUserCount(count);
    });

    socket.on("userTyping", ({ user, isTyping, uniqueId }) => {
      setTypingUsers(prev => {
        const newSet = new Set(prev);
        const userIdentifier = uniqueId ? `${user}#${uniqueId}` : user;
        if (isTyping) {
          newSet.add(userIdentifier);
        } else {
          newSet.delete(userIdentifier);
        }
        return newSet;
      });
    });

    socket.on('error', (errorMessage) => {
      console.error('Socket error received:', errorMessage);
      setMessages((prev) => [...prev, {
        user: 'System',
        text: `Error: ${errorMessage}`,
        timestamp: new Date().toLocaleTimeString(),
        color: '#FF0000'
      }]);
      
      // Handle specific password errors
      if (errorMessage.includes('password') || errorMessage.includes('Password')) {
        handleWrongPassword();
      } else {
        // For other errors, also reset joining state
        setIsJoining(false);
        setJoinAttempted(false);
        setPasswordError(errorMessage);
      }
    });

    socket.on('roomEncrypted', () => {
      // Server tells us this room uses encryption
      console.log('Server confirmed room is encrypted');
    });

    // Handle successful room join
    socket.on('joinSuccess', ({ room: joinedRoom, isCreator }) => {
      console.log('Join success received:', joinedRoom, isCreator);
      setShowPasswordPrompt(false);
      setPasswordError('');
      setIsJoining(false);
      setJoinAttempted(false);
      setIsCreatingRoom(isCreator);
      
      // Add a system message about room join
      const systemMessage = {
        user: 'System',
        text: isCreator ? `Room "${joinedRoom}" created successfully. You are the room creator.` : `Joined room "${joinedRoom}" successfully.`,
        timestamp: new Date().toLocaleTimeString(),
        color: '#00FF00',
        isEncrypted: false
      };
      setMessages((prev) => [...prev, systemMessage]);
      
      console.log('Successfully joined room:', joinedRoom, 'Is creator:', isCreator);
    });

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("message");
      socket.off("userCount");
      socket.off("userTyping");
      socket.off("error");
      socket.off("roomEncrypted");
      socket.off("joinSuccess");
      socket.disconnect();
    };
  }, [room, username]);

  const decodeHtmlEntities = (text) => {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    return textarea.value;
  };

  const copyToClipboard = async (text, elementId) => {
    let success = false;
    let message = '';
    try {
      const decodedTextForCopy = decodeHtmlEntities(text);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(decodedTextForCopy);
        success = true;
        message = 'Copied!';
      } else {
        const tempTextArea = document.createElement('textarea');
        tempTextArea.value = decodedTextForCopy;
        tempTextArea.style.position = 'fixed';
        tempTextArea.style.left = '-9999px';
        document.body.appendChild(tempTextArea);
        tempTextArea.focus();
        tempTextArea.select();
        try {
          document.execCommand('copy');
          success = true;
          message = 'Copied!';
        } catch (err) {
          message = 'Failed to copy!';
          console.error('Fallback copy failed: ', err);
        } finally {
          document.body.removeChild(tempTextArea);
        }
      }
    } catch (err) {
      message = 'Failed to copy!';
      console.error('Failed to copy: ', err);
    } finally {
      setShowCopyFeedback({ visible: true, message, type: success ? 'success' : 'error' });
      setTimeout(() => setShowCopyFeedback({ visible: false, message: '', type: '' }), 2000);

      const copyButton = document.getElementById(`copy-btn-${elementId}`);
      if (copyButton) {
        copyButton.textContent = success ? 'Copied!' : 'Failed!';
        setTimeout(() => {
          copyButton.textContent = 'Copy';
        }, 2000);
      }
    }
  };

  const formatMessageContent = (msg, idx) => {
    const text = msg.text;

    if (text.startsWith('```') && text.endsWith('```')) {
      const codeContentEncoded = text.substring(3, text.length - 3);

      return (
        <div className="relative bg-gray-800 p-2 rounded text-white overflow-x-hidden my-1 w-full min-w-0">
          <button
            id={`copy-btn-${idx}`}
            onClick={() => copyToClipboard(codeContentEncoded, idx)}
            className="absolute top-1 right-2 bg-green-700 text-white text-xs px-2 py-1 rounded hover:bg-green-600 transition-colors z-10 min-w-[44px] min-h-[30px] flex items-center justify-center sm:min-h-[44px]"
          >
            Copy
          </button>
          <pre className="whitespace-pre-wrap break-all mt-6 text-sm">
            <code dangerouslySetInnerHTML={{ __html: codeContentEncoded }} />
          </pre>
        </div>
      );
    }
    const formattedTextWithBreaks = text.replace(/\n/g, '<br />');
    return <span className="break-all flex-1 min-w-0" dangerouslySetInnerHTML={{ __html: formattedTextWithBreaks }} />;
  };

  const handleSend = async (e) => {
    e.preventDefault();
    const messageToSend = input.trim();

    if (messageToSend && isConnected) {
      try {
        if (encryptionEnabled && encryption.hasRoomKey(room)) {
          // Send encrypted message
          const encryptedData = await encryption.encryptMessage(messageToSend, room);
          socket.emit("sendMessage", {
            encrypted: encryptedData.encrypted,
            iv: encryptedData.iv,
            isEncrypted: true
          });
        } else {
          // Send plain text message (fallback - shouldn't happen in new design)
          socket.emit("sendMessage", messageToSend);
        }

        setInput('');
        socket.emit("stopTyping");
        if (typingTimeoutRef.current) {
          clearTimeout(typingTimeoutRef.current);
        }
        if (textareaRef.current) {
          textareaRef.current.focus();
        }
      } catch (error) {
        console.error('Failed to send message:', error);
        setMessages(prev => [...prev, {
          user: 'System',
          text: 'Failed to encrypt/send message. Please try again.',
          timestamp: new Date().toLocaleTimeString(),
          color: '#FF0000'
        }]);
      }
    }
  };

  const handleInputChange = (e) => {
    setInput(e.target.value);

    if (isConnected && !showPasswordPrompt) {
      if (e.target.value.trim().length > 0) {
        socket.emit("startTyping");

        if (typingTimeoutRef.current) {
          clearTimeout(typingTimeoutRef.current);
        }

        typingTimeoutRef.current = setTimeout(() => {
          socket.emit("stopTyping");
        }, 1000);
      } else {
        socket.emit("stopTyping");
        if (typingTimeoutRef.current) {
          clearTimeout(typingTimeoutRef.current);
        }
      }
    }
  };

  const handleInputBlur = () => {
    scrollToBottom();
  };

  // Show password prompt dialog - always required now
  if (showPasswordPrompt || !encryptionEnabled) {
    return (
      <div className="bg-black text-green-500 font-mono h-screen p-4 flex items-center justify-center">
        <div className="border border-green-500 p-6 rounded max-w-md w-full">
          <h2 className="text-lime-400 text-xl mb-4 text-center">🔒 Room Password Required</h2>
          <p className="text-sm mb-4 text-gray-300">
            {joinAttempted ? 
              "Enter the correct room password to join." : 
              "Enter a password to create/join this room. If the room exists, you need the correct password to join."
            }
          </p>
          
          {passwordError && (
            <div className="text-red-500 text-sm mb-4 p-2 border border-red-500 rounded">
              {passwordError}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <div className="block text-sm mb-2">
                {joinAttempted ? "Room Password:" : "Set/Enter Room Password:"}
              </div>
              <input
                type="password"
                className="w-full bg-black border border-green-500 px-3 py-2 text-green-500 outline-none"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder={joinAttempted ? "Enter room password" : "Create or enter room password"}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handlePasswordSubmit(e);
                  }
                }}
                autoFocus
                disabled={isJoining}
              />
            </div>
            
            <button
              onClick={handlePasswordSubmit}
              className="w-full px-4 py-2 border border-green-500 hover:bg-green-500 hover:text-black transition-colors disabled:opacity-50"
              disabled={!passwordInput.trim() || isJoining}
            >
              {isJoining ? 'Joining...' : (joinAttempted ? 'Join Room' : 'Create/Join Room')}
            </button>

            {!isConnected && (
              <div className="text-yellow-500 text-sm text-center">
                Connecting to server...
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-black text-green-500 font-mono h-screen p-2 sm:p-4 flex flex-col overflow-hidden">
      <div className="border-b border-green-500 pb-2 mb-2 sm:mb-4 flex flex-col sm:flex-row justify-between items-center flex-shrink-0">
        <span className="text-lime-400 mb-1 sm:mb-0 text-sm sm:text-base">
          Room: {room} {encryptionEnabled ? '🔒' : '📝'}
          {isCreatingRoom && <span className="text-xs text-lime-300 ml-2">(Creator)</span>}
        </span>
        <div className="flex items-center space-x-2 sm:space-x-4">
          <span className="text-xs sm:text-sm">Users: {userCount}</span>
          <span className={`text-xs sm:text-sm ${isConnected ? 'text-lime-400' : 'text-red-500'}`}>
            {isConnected ? '● Connected' : '● Disconnected'}
          </span>
          {encryptionEnabled && (
            <span className="text-xs text-lime-300">Protected Room</span>
          )}
        </div>
      </div>

      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto mb-2 sm:mb-4 space-y-1 pr-1" onBlur={handleInputBlur}>
        {messages.map((msg, idx) => (
          <div key={idx} className="flex flex-col sm:flex-row items-start min-w-0">
            <div className="flex-shrink-0 flex items-baseline w-full sm:w-auto mr-1 sm:mr-2">
              <span className="text-gray-400 text-xs sm:text-sm mr-1 sm:mr-2">[{msg.timestamp}]</span>
              <span
                className={msg.user === 'System' ? 'text-yellow-400' : 'font-bold'}
                style={{ color: msg.color || (msg.user === 'System' ? '#FFFF00' : '#ADFF2F') }}
              >
                {msg.encryptionIcon && <span className="mr-1">{msg.encryptionIcon}</span>}
                {msg.user === 'System' ? '***' : `${msg.user}${msg.uniqueId ? `#${msg.uniqueId}` : ''}:`}
              </span>
            </div>
            {formatMessageContent(msg, idx)}
          </div>
        ))}

        {typingUsers.size > 0 && (
          <div className="text-gray-400 text-xs sm:text-sm italic" aria-live="polite">
            {Array.from(typingUsers).join(', ')} {typingUsers.size === 1 ? 'is' : 'are'} typing...
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {showCopyFeedback.visible && (
        <div
          className={`fixed bottom-20 left-1/2 -translate-x-1/2 p-2 rounded text-white text-sm sm:text-base z-50
                      ${showCopyFeedback.type === 'success' ? 'bg-green-700' : 'bg-red-700'}`}
          aria-live="assertive"
        >
          {showCopyFeedback.message}
        </div>
      )}

      <div className="flex flex-col sm:flex-row items-center flex-shrink-0">
        <span className="text-lime-400 mr-1 sm:mr-2 flex-shrink-0 mb-2 sm:mb-0 text-lg sm:text-base">
          {encryptionEnabled ? '🔒' : '📝'}&gt;
        </span>
        <textarea
          ref={textareaRef}
          className="bg-black border border-green-500 flex-grow px-2 py-1 outline-none text-green-500 resize-none w-full sm:w-auto min-w-0 text-sm sm:text-base"
          value={input}
          onChange={handleInputChange}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (isMobile.current) {
                if (!e.shiftKey) {
                  e.preventDefault();
                }
              } else {
                if (!e.shiftKey) {
                  e.preventDefault();
                  handleSend(e);
                }
              }
            }
          }}
          onBlur={handleInputBlur}
          placeholder={isConnected ? 
            `Type a message (${encryptionEnabled ? 'Encrypted' : 'Plain text'})...` : 
            "Connecting..."
          }
          disabled={!isConnected}
          autoFocus
          rows={1}
          maxLength={20000}
        />
        <button
          onClick={handleSend}
          className="ml-0 sm:ml-2 mt-2 sm:mt-0 px-4 py-1 border border-green-500 hover:bg-green-500 hover:text-black transition-colors disabled:opacity-50 w-full sm:w-auto min-h-[44px] min-w-[44px] text-sm sm:text-base"
          disabled={!isConnected || !input.trim()}
        >
          Send {encryptionEnabled ? '🔒' : '📝'}
        </button>
      </div>
    </div>
  );
}