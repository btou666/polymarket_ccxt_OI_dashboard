import Dashboard from "@/components/dashboard";

export default function SymbolPage({ searchParams }) {
  const symbol = typeof searchParams?.symbol === "string" ? searchParams.symbol : "";
  return <Dashboard initialSymbol={symbol} />;
}
