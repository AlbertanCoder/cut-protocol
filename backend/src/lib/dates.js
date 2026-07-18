const dayNum = (d) => Math.round(Date.parse(d + "T12:00:00") / 864e5);
const todayStr = () => new Date().toISOString().slice(0, 10);

const addDays = (d, n) => {
  const t = new Date(d + "T12:00:00");
  t.setDate(t.getDate() + Math.round(n));
  return t.toISOString().slice(0, 10);
};

// Monday of the week containing `dateStr`.
function mondayOf(dateStr) {
  const t = new Date(dateStr + "T12:00:00");
  const day = t.getDay(); // 0 = Sunday
  const diffToMonday = day === 0 ? -6 : 1 - day;
  return addDays(dateStr, diffToMonday);
}

module.exports = { dayNum, todayStr, addDays, mondayOf };
