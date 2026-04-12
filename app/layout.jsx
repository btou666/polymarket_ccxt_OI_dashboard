import "./globals.css";

export const metadata = {
  title: "Binance Futures OI Dashboard",
  description: "Track Binance USDT perpetual open interest every minute via ccxt",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
