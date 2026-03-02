export default function StatCard({ title, value }) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-6">
      <p className="text-sm text-gray-500">{title}</p>
      <h2 className="text-3xl font-semibold mt-2">
        {value}
      </h2>
    </div>
  );
}