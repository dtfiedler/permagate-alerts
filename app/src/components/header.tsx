import { useState } from 'react';

const Header = () => {
  const [isConnected, setIsConnected] = useState(false);

  const handleConnect = () => {
    // TODO: Implement wallet connection logic
    setIsConnected(!isConnected);
  };

  return (
    <header className="text-white h-[50px] flex items-center justify-between p-8">
      <div className="flex items-center"></div>

      <button
        onClick={handleConnect}
        className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
      >
        {isConnected ? 'Connected' : 'Connect Wallet'}
      </button>
    </header>
  );
};

export default Header;
