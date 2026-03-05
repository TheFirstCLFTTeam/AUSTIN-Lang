export default function ErrorChart({ accuracy }) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-6">
      <h3 className="font-semibold mb-4">
        Estimated Accuracy
      </h3>

      <div className="w-full bg-gray-200 rounded-full h-6">
        <div
          className="bg-blue-600 h-6 rounded-full text-white text-sm flex items-center justify-center"
          style={{ width: `${accuracy}%` }}
        >
          {accuracy}%
        </div>
      </div>
    </div>
  );
}