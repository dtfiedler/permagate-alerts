import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';

const subscribeEmail = async (email: string): Promise<any> => {
  const response = await fetch(
    `http://localhost:3000/api/subscribe?email=${encodeURIComponent(email)}`,
    {
      method: 'POST',
    },
  );
  if (!response.ok) {
    throw new Error('Subscription failed');
  }
  return;
};

const SubscribeForm: React.FC = () => {
  const [email, setEmail] = useState('');
  const [success, setSuccess] = useState(false);

  const mutation = useMutation<any, Error, string, unknown>({
    mutationFn: subscribeEmail,
    onSuccess: () => setSuccess(true),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate(email);
  };

  const loading = mutation.status === 'pending';

  return (
    <>
      {!success ? (
        <form onSubmit={handleSubmit} className="w-full p-8 space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium mb-2 text-left"
            >
              Email Address
            </label>
            <input
              type="email"
              id="email"
              name="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-md transition duration-300"
          >
            {loading ? 'Subscribing...' : 'Subscribe'}
          </button>
          {mutation.status === 'error' && (
            <div className="text-red-500 text-sm mt-2">
              An error occurred. Please try again.
            </div>
          )}
        </form>
      ) : (
        <div className="text-green-500 text-center mt-4">
          Successfully subscribed! Check your email for confirmation.
        </div>
      )}
    </>
  );
};

export default SubscribeForm;
