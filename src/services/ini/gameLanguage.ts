import { EventEmitter, window } from 'vscode';
import type { Disposable, Memento } from 'vscode';
import type { ArchiveModel } from '../archives/archiveModel';
import {
  AUTO_LANGUAGE,
  chooseLanguage,
  installedLanguages,
} from '../../game/text/gameLanguage';
import { onDidChangeSetting, settings } from '../../platform/settings';
import type { SageIniIndex } from './sageIniIndex';

/**
 * The language the game's text is read in. The install holds one string
 * table per `lang/<Language>.big`; this settles which one labels resolve
 * against, from the `bigfs.language` setting. "auto" takes the only language
 * installed, else asks once and remembers the answer in the workspace.
 */

const REMEMBERED = 'bigfs.language.chosen';

export class GameLanguage implements Disposable {
  private readonly changed = new EventEmitter<string | undefined>();
  private readonly subscription: Disposable;
  private asking?: Promise<string | undefined>;
  private declined?: string;

  /** Fires with the language text is now read in */
  public readonly onDidChange = this.changed.event;

  public constructor(
    private readonly archiveModel: ArchiveModel,
    private readonly state: Memento,
    private readonly index: SageIniIndex,
  ) {
    this.subscription = onDidChangeSetting([settings.language], () => {
      void this.ensure();
    });
  }

  public dispose(): void {
    this.subscription.dispose();
    this.changed.dispose();
  }

  /** The languages the install's `lang` archives hold */
  public async installed(): Promise<string[]> {
    await this.archiveModel.whenReady();
    return installedLanguages(
      this.archiveModel
        .getArchiveRoots()
        .map((root) => root.archive.archivePath),
    );
  }

  /**
   * Settles the language and applies it to the index, asking when several
   * are installed and none was chosen. Callers await this before they
   * resolve a label.
   */
  public async ensure(): Promise<string | undefined> {
    const installed = await this.installed();
    const choice = chooseLanguage(
      settings.language.get(),
      installed,
      this.state.get<string>(REMEMBERED),
    );
    let language = choice.language;

    if (choice.ask) {
      this.asking ??= this.askOnce(installed).finally(() => {
        this.asking = undefined;
      });
      language = await this.asking;
    }
    this.apply(language);
    return language;
  }

  /** The command: pick a language from those installed */
  public async choose(): Promise<void> {
    const installed = await this.installed();

    if (!installed.length) {
      void window.showInformationMessage(
        'No lang/<Language>.big archive was found, so the game has no text language to choose.',
      );
      return;
    }

    const picked = await this.pick(installed);

    if (picked) {
      await this.remember(picked);
      this.apply(picked);
    }
  }

  private apply(language: string | undefined): void {
    this.index.setLanguage(language);
    this.changed.fire(language);
  }

  /** Remembers a choice, and writes it over a setting that named another language */
  private async remember(language: string): Promise<void> {
    await this.state.update(REMEMBERED, language);

    if (settings.language.get() !== AUTO_LANGUAGE) {
      await settings.language.update(language);
    }
  }

  private pick(installed: readonly string[]): Thenable<string | undefined> {
    const current = this.state.get<string>(REMEMBERED);

    return window
      .showQuickPick(
        installed.map((language) => ({
          label: language,
          description: language === current ? 'current' : undefined,
        })),
        {
          title: 'bigFS: Choose Game Language',
          placeHolder: 'Game text language',
        },
      )
      .then((item) => item?.label);
  }

  /**
   * Asks which language to use. Dismissing the pick still has to give text,
   * so English (else the first installed) stands in until the next session
   * without being remembered.
   */
  private async askOnce(installed: string[]): Promise<string> {
    if (this.declined && installed.includes(this.declined)) {
      return this.declined;
    }

    const picked = await this.pick(installed);

    if (picked) {
      await this.remember(picked);
      return picked;
    }
    this.declined = installed.includes('english') ? 'english' : installed[0];
    return this.declined;
  }
}
