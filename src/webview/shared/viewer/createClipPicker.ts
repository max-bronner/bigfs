/** One animation the viewer's list offers */
export interface ClipChoice {
  /** What the list hands back when it is picked */
  id: string;
  label: string;
}

/** The animations the list offers: the model's own, then a group made for other skeletons */
export interface ClipList {
  own: ClipChoice[];
  foreign?: ClipChoice[];
}

/** The viewer's animation list */
export interface ClipPicker {
  select: HTMLSelectElement;
  setList(list: ClipList): void;
  /** Shows a choice as picked; none is the bind pose */
  show(id: string | undefined): void;
  /** Says what the first row means for the model on show */
  setHasSkeleton(hasSkeleton: boolean): void;
}

/** Creates the animation list; `onPick` gets the choice, undefined for the bind pose */
export const createClipPicker = (
  onPick: (id: string | undefined) => void,
): ClipPicker => {
  const select = document.createElement('select');
  const none = new Option('No skeleton', '');
  let hasChoices = false;
  let hasBones = false;

  select.title = 'Animation';
  select.append(none);
  select.disabled = true;
  select.onchange = () => onPick(select.value || undefined);

  const refresh = () => {
    none.textContent = hasBones || hasChoices ? 'Bind pose' : 'No skeleton';
    select.disabled = !hasBones && !hasChoices;
  };
  const toOption = ({ id, label }: ClipChoice) => new Option(label, id);

  return {
    select,
    setList: ({ own, foreign = [] }) => {
      const group = document.createElement('optgroup');

      group.label = 'Made for other skeletons';
      group.append(...foreign.map(toOption));
      select.replaceChildren(
        none,
        ...own.map(toOption),
        ...(foreign.length ? [group] : []),
      );
      hasChoices = own.length + foreign.length > 0;
      refresh();
    },
    show: (id) => {
      select.value = id ?? '';
    },
    setHasSkeleton: (hasSkeleton) => {
      hasBones = hasSkeleton;
      refresh();
    },
  };
};
