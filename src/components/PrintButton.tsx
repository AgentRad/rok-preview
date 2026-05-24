"use client";

export default function PrintButton() {
  return (
    <button
      type="button"
      className="btn btn-dark btn-sm"
      onClick={() => window.print()}
    >
      Print or save as PDF
    </button>
  );
}
