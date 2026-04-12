import "./globals.css";

export const metadata = {
  title: "Binance Aggregated OI Dashboard",
  description: "Aggregate Binance USDT contract open interest across exchanges via ccxt",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
