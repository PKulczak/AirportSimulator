import { ProgressSpinner } from 'primereact/progressspinner';
import backgroundImage from '../assets/Background.png';

/**
 * Full-page loading state shown while a screen's initial data fetch is in
 * flight. Matches the background-image + bordered white "box" shell every
 * other screen (history, detail, visualisation) uses, just left blank with a
 * centered spinner instead of any content — so the transition into the
 * loaded screen doesn't jump from a bare line of text to the full frame.
 */
export default function LoadingScreen() {
  return (
    <div className="-m-6 h-[calc(100%+3rem)] flex flex-col">
      <div
        className="relative flex-1 min-h-0 overflow-hidden p-4 sm:p-10 flex items-center justify-center"
        style={{
          backgroundImage: `url(${backgroundImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      >
        <div
          className="flex min-w-[800px] items-center justify-center rounded-lg border-2 border-black bg-white shadow-2xl"
          style={{ width: '100%', maxWidth: '1600px', maxHeight: '100%', aspectRatio: '1.5' }}
        >
          <ProgressSpinner strokeWidth="4" />
        </div>
      </div>
    </div>
  );
}
