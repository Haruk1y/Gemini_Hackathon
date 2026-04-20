export function placeholderImageUrl(label: string): string {
  const text = (label.trim().slice(0, 60) || "image").replace(/\s+/g, " ");
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
      <rect width="1024" height="1024" fill="#FFF7E6"/>
      <rect x="64" y="64" width="896" height="896" rx="40" fill="#ffffff" stroke="#101010" stroke-width="16"/>
      <text
        x="512"
        y="512"
        text-anchor="middle"
        dominant-baseline="middle"
        font-family="'Helvetica Neue', Arial, sans-serif"
        font-size="52"
        font-weight="700"
        fill="#101010"
      >${text}</text>
    </svg>
  `;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}
