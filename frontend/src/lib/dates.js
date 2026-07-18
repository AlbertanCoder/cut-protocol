export const dayNum = (d) => Math.round(Date.parse(d + "T12:00:00") / 864e5);

export const todayStr = () => {
  const t = new Date();
  return (
    t.getFullYear() + "-" +
    String(t.getMonth() + 1).padStart(2, "0") + "-" +
    String(t.getDate()).padStart(2, "0")
  );
};

export const addDays = (d, n) => {
  const t = new Date(d + "T12:00:00");
  t.setDate(t.getDate() + Math.round(n));
  return t.toISOString().slice(0, 10);
};

export const fmtD = (d) =>
  new Date(d + "T12:00:00").toLocaleDateString("en-CA", { month: "short", day: "numeric" });

export const fmtDY = (d) =>
  new Date(d + "T12:00:00").toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
