import { ImageResponse } from "next/og";

/** iOS home-screen icon: the Dealscope lens on the lime tile (D-088). */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#d4f53c" }}>
        <svg width="112" height="112" viewBox="0 0 24 24" fill="none" stroke="#111208" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="10.5" cy="10.5" r="7" strokeWidth="2.2" />
          <path d="M15.7 15.7 20.6 20.6" strokeWidth="2.6" />
          <rect x="6.9" y="11" width="1.9" height="3" rx="0.95" fill="#111208" stroke="none" />
          <rect x="9.55" y="9" width="1.9" height="5" rx="0.95" fill="#111208" stroke="none" />
          <rect x="12.2" y="7" width="1.9" height="7" rx="0.95" fill="#111208" stroke="none" />
        </svg>
      </div>
    ),
    size,
  );
}
