import type { IssueCategory } from '@/models/issue';

export interface DemoAttribution {
  title: string;
  author: string;
  url: string;
  license: 'CC BY 2.0';
  licenseUrl: string;
}

export interface DemoScenario {
  id: string;
  title: string;
  /** What a person would call the problem in the photo (not the model's answer). */
  shows: IssueCategory;
  summary: string;
  /** Bundled photo (`require`d so Metro packages it). */
  image: number;
  /**
   * Sample location used instead of GPS, clearly labeled in the app. Real
   * civic lookups run against it when they are enabled.
   */
  location: { latitude: number; longitude: number; label: string };
  attribution: DemoAttribution;
}

const CC_BY_2 = 'https://creativecommons.org/licenses/by/2.0/';

/**
 * Six sample photos for Demo Mode. They are Open Images V7 photos from
 * Flickr (CC BY 2.0). None of them was used to train the model: five are not
 * in the CivicLens dataset at all, and the stop sign is in it only as a
 * `damaged_sign` example, a class the model does not learn.
 *
 * The app does not store expected answers for these photos. Each run sends
 * the photo through the same analysis as a camera scan and shows whatever the
 * model returns, including "no supported issue" for categories it cannot
 * detect yet.
 */
export const DEMO_SCENARIOS: readonly DemoScenario[] = [
  {
    id: 'pothole',
    title: 'Pothole',
    shows: 'pothole',
    summary: 'Several water-filled potholes across a city street.',
    image: require('../../assets/demo/pothole.jpg') as number,
    location: { latitude: 41.87811, longitude: -87.62980, label: 'Sample location: downtown Chicago, IL' },
    attribution: {
      title: 'Typical Torontorian Pothole(s)',
      author: 'Michael Gil',
      url: 'https://www.flickr.com/photos/msvg/4304094088',
      license: 'CC BY 2.0',
      licenseUrl: CC_BY_2,
    },
  },
  {
    id: 'sidewalk',
    title: 'Damaged sidewalk',
    shows: 'sidewalk_damage',
    summary: 'A broken, washed-out sidewalk edge next to a road.',
    image: require('../../assets/demo/sidewalk.jpg') as number,
    location: { latitude: 37.33772, longitude: -121.88634, label: 'Sample location: downtown San José, CA' },
    attribution: {
      title: "This sidewalk's washed away",
      author: 'Tonamel',
      url: 'https://www.flickr.com/photos/tonamel/2560162640',
      license: 'CC BY 2.0',
      licenseUrl: CC_BY_2,
    },
  },
  {
    id: 'blocked-sidewalk',
    title: 'Blocked sidewalk',
    shows: 'pedestrian_obstruction',
    summary: 'An SUV parked across the sidewalk, leaving little room to pass.',
    image: require('../../assets/demo/blocked-sidewalk.jpg') as number,
    location: { latitude: 42.36008, longitude: -71.05888, label: 'Sample location: Boston, MA' },
    attribution: {
      title: 'SUV Parked on Pavement',
      author: 'I See Modern Britain',
      url: 'https://www.flickr.com/photos/27128437@N07/3072635988',
      license: 'CC BY 2.0',
      licenseUrl: CC_BY_2,
    },
  },
  {
    id: 'graffiti',
    title: 'Graffiti',
    shows: 'graffiti',
    summary: 'Spray-painted tags and characters covering a wall.',
    image: require('../../assets/demo/graffiti.jpg') as number,
    location: { latitude: 37.77926, longitude: -122.41927, label: 'Sample location: Civic Center, San Francisco, CA' },
    attribution: {
      title: 'Graffiti Street',
      author: 'Ella Mullins',
      url: 'https://www.flickr.com/photos/stincodiporco/5832473984',
      license: 'CC BY 2.0',
      licenseUrl: CC_BY_2,
    },
  },
  {
    id: 'litter',
    title: 'Overflowing trash',
    shows: 'overflowing_trash',
    summary: 'Cans, bags and litter piled up beside a path.',
    image: require('../../assets/demo/litter.jpg') as number,
    location: { latitude: 40.71274, longitude: -74.00602, label: 'Sample location: Lower Manhattan, New York, NY' },
    attribution: {
      title: "Litter in a 'Green and Pleasant' land",
      author: 'Patrick van IJzendoorn',
      url: 'https://www.flickr.com/photos/33630119@N07/5869660548',
      license: 'CC BY 2.0',
      licenseUrl: CC_BY_2,
    },
  },
  {
    id: 'damaged-sign',
    title: 'Damaged sign',
    shows: 'damaged_sign',
    summary: 'A stop sign dented by several bullet holes.',
    image: require('../../assets/demo/damaged-sign.jpg') as number,
    location: { latitude: 33.44838, longitude: -112.07404, label: 'Sample location: downtown Phoenix, AZ' },
    attribution: {
      title: 'rural life',
      author: 'andres musta',
      url: 'https://www.flickr.com/photos/andresmusta/6264442425',
      license: 'CC BY 2.0',
      licenseUrl: CC_BY_2,
    },
  },
];

export const findDemoScenario = (id: string): DemoScenario | undefined => DEMO_SCENARIOS.find((s) => s.id === id);
