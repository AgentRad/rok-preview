import { Composition } from "remotion";
import { PartsPortVideo } from "./Video";
import { FPS, SIZE, VIDEOS, totalFrames } from "./scenes";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {Object.values(VIDEOS).map((spec) => (
        <Composition
          key={spec.id}
          id={spec.id}
          component={PartsPortVideo}
          durationInFrames={totalFrames(spec)}
          fps={FPS}
          width={SIZE}
          height={SIZE}
          defaultProps={{ spec }}
        />
      ))}
    </>
  );
};
