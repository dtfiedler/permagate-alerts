import { Outlet } from '@tanstack/react-router';
import Header from './header';
import Footer from './footer';

const Layout = () => {
  return (
    <div className="flex-col h-screen w-screen bg-black">
      {/* <div className="overflow- absolute bottom-[-15%] left-[-15%] w-full opacity-10 h-200 bg-[url('/assets/arweave_glyph_light.svg')] bg-no-repeat bg-opacity-5"></div> */}
      <Header />
      <div className="min-h-[calc(100vh-150px)] flex items-center justify-center">
        <Outlet />
      </div>
      <Footer />
    </div>
  );
};

export default Layout;
