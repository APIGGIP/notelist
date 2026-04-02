export function parsePriceInput(rawValue: string) {
  const normalized = rawValue.trim().replaceAll(",", "");

  if (!normalized) {
    return {
      cents: 0,
      normalized: ""
    };
  }

  if (!/^\d+(\.\d{0,2})?$/.test(normalized)) {
    return {
      cents: null,
      normalized,
      error: "價格請輸入數字，最多到小數點後兩位。"
    };
  }

  const [whole, decimal = ""] = normalized.split(".");
  const cents = Number(whole) * 100 + Number(`${decimal}00`.slice(0, 2));

  return {
    cents,
    normalized
  };
}

export function formatCurrency(cents: number) {
  const amount = cents / 100;
  const hasDecimals = cents % 100 !== 0;

  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2
  }).format(amount);
}
