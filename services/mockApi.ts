
import { Article, Category, Importance } from '../types';

const CATEGORIES: Category[] = ['Technology', 'Design', 'Future', 'Networking'];
const IMPORTANCES: Importance[] = ['high', 'medium', 'low'];

// Added version property to match Article interface
const generateMockArticles = (): Article[] => Array.from({ length: 24 }, (_, i) => ({
  id: `art-${i + 1}`,
  category: CATEGORIES[i % CATEGORIES.length],
  importance: (i % 5 === 0) ? 'high' : IMPORTANCES[i % 3],
  sizeKb: Math.floor(Math.random() * 200) + 50,
  version: 1,
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
  content: `This is the full content for the article. It contains detailed technical insights about ${CATEGORIES[i % CATEGORIES.length].toLowerCase()} trends. In a real-world scenario, this would be thousands of words of Markdown or HTML fetched from a secure Node.js backend. Our system ensures this content is pre-cached when your Wi-Fi signal is strong, allowing for instant access during commutes or in dead zones. Building for the offline web requires a shift in mindset—from reactive to proactive fetching. By leveraging the Network Information API, we can detect if a user is on a metered connection or has high latency, adjusting our data transfer strategies accordingly. This might mean only downloading text content and deferring heavy image assets until a more robust connection is established. Storage management is equally critical; browsers impose quotas on how much data an origin can store. Using the StorageManager API, apps can query available space and proactively clear older or less critical caches to make room for new updates. The ultimate goal is a user experience that feels completely uncoupled from the volatility of modern internet connectivity.`,
  author: ["Sarah Chen", "Marcus Bell", "Elena Rodriguez", "James Wilson"][i % 4],
  date: new Date(Date.now() - i * 43200000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
  imageUrl: `https://picsum.photos/seed/wifi-${i}/800/500`
}));

export const fetchArticlesFromCloud = async (onProgress?: (p: number) => void): Promise<Article[]> => {
  const data = generateMockArticles();
  // Simulate chunked downloading for progress visualization
  for (let i = 1; i <= 10; i++) {
    await new Promise(resolve => setTimeout(resolve, 150));
    if (onProgress) onProgress(i * 10);
  }
  return data;
};
