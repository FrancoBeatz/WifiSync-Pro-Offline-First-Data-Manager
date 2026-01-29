
import { Article, Category } from '../types';

const CATEGORIES: Category[] = ['Technology', 'Design', 'Future', 'Networking'];

const generateMockArticles = (): Article[] => Array.from({ length: 24 }, (_, i) => ({
  id: `art-${i + 1}`,
  category: CATEGORIES[i % CATEGORIES.length],
  title: [
    "Resilient Web Apps with IndexedDB",
    "Mastering the Network Information API",
    "The Evolution of Service Workers",
    "Offline-First Design Patterns",
    "Optimizing Images for Low Bandwidth",
    "Syncing Data in High-Latency Environments",
    "Web Performance in 2025",
    "Privacy and Local Storage",
  ][i % 8] + (i > 7 ? ` (Chapter ${Math.floor(i / 8) + 1})` : ""),
  excerpt: "Discover how to build applications that thrive without a continuous internet connection, leveraging the latest browser storage APIs.",
  content: `This is the full content for the article. It contains detailed technical insights about ${CATEGORIES[i % CATEGORIES.length].toLowerCase()} trends. In a real-world scenario, this would be thousands of words of Markdown or HTML fetched from a secure Node.js backend. Our system ensures this content is pre-cached when your Wi-Fi signal is strong, allowing for instant access during commutes or in dead zones.`,
  author: ["Sarah Chen", "Marcus Bell", "Elena Rodriguez", "James Wilson"][i % 4],
  date: new Date(Date.now() - i * 43200000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
  imageUrl: `https://picsum.photos/seed/wifi-${i}/800/500`
}));

export const fetchArticlesFromCloud = async (onProgress?: (p: number) => void): Promise<Article[]> => {
  const data = generateMockArticles();
  // Simulate chunked downloading for progress visualization
  for (let i = 1; i <= 5; i++) {
    await new Promise(resolve => setTimeout(resolve, 200));
    if (onProgress) onProgress(i * 20);
  }
  return data;
};
