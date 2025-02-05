import SubscribeForm from '../components/subscribe-form';
import Footer from '../components/footer';

export const Subscribe = () => {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center">
      <h1 className="text-3xl font-semibold mb-6 text-center">
        Permagate Alerts
      </h1>
      <p className="text-center mb-6 text-gray-400 text-sm max-w-[25vw]">
        Get notified about important events in the{' '}
        <a href="https://ar.io">
          <b>
            <u>AR.IO</u>
          </b>
        </a>{' '}
        network process. Stay informed about contract reward distributions, ArNS
        name expirations, and more.
        <SubscribeForm />
      </p>
    </div>
  );
};
