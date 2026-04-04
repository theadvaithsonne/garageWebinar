import './globals.css';
import ToastContainer from '../components/Toast';

export const metadata = {
  title: 'WebinarApp',
  description: 'Professional webinar platform powered by WebRTC',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-950 text-white">
        {children}
        <ToastContainer />
      </body>
    </html>
  );
}
