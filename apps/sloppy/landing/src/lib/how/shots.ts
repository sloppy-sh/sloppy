// The pictures beside the stages: Sloppy running, cropped to the part of it the stage is about.
// Only the stages a real screenshot illustrates have one.
import graphPicture from '../../../../../../docs/images/reading-the-graph.jpg';
import outlinePicture from '../../../../../../docs/images/reading-the-outline.jpg';
import type { StageId } from './pipeline';

/** Every crop is drawn this wide for its height, so the slot never changes size. */
const ASPECT = 2.67;

const SOURCE = { width: 1600, height: 1039 };

export interface Shot {
	src: string;
	alt: string;
	caption: string;
	/** The part shown, in the picture's own pixels; its height follows the frame's shape. */
	crop: { x: number; y: number; width: number };
}

export const SHOTS: Partial<Record<StageId, Shot>> = {
	notes: {
		src: graphPicture,
		alt: "A project's notes drawn as points joined by lines, each note's title beside its point.",
		caption: 'The graph reading.',
		crop: { x: 225, y: 250, width: 560 }
	},
	code: {
		src: outlinePicture,
		alt: 'A note open in Sloppy, with a link to the file it explains under its title.',
		caption: 'A note, and the file it explains.',
		crop: { x: 400, y: 265, width: 620 }
	},
	shape: {
		src: outlinePicture,
		alt: 'The same notes as rows, each nested under the note it sprang out of and carrying its tags.',
		caption: 'The outline reading.',
		crop: { x: 364, y: 95, width: 700 }
	}
};

/** The crop as the frame's CSS reads it: its shape, and the picture's left, top and width as fractions. */
export const framing = (shot: Shot) =>
	`--shot-a:${ASPECT};--shot-x:${shot.crop.x / SOURCE.width};--shot-y:${shot.crop.y / SOURCE.height};--shot-w:${shot.crop.width / SOURCE.width}`;
