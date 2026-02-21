export function placeholderImageUrl(label: string): string {
  const text = encodeURIComponent(label.trim().slice(0, 60) || "image");
  return `https://placehold.co/1024x1024/FFF7E6/101010/png?text=${text}`;
}
