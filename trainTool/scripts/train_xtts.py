"""Fine-tune the XTTS-v2 text-to-speech model on one speaker's prepared clips (see prepare_tts.py).

    python train_xtts.py --model_dir <XTTS-v2 folder> --dataset <prepared folder> --output_dir <out> --language hi

<model_dir> holds the base files: model.pth, config.json, vocab.json, dvae.pth, mel_stats.pth.
Writes <output_dir>/final/{model.pth, config.json, vocab.json, reference.wav}, which tts_speak.py can load.
Runs inside the speech environment (coqui-tts).
"""
import argparse
import glob
import os
import shutil
import sys

from speech_common import say


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model_dir", required=True)
    ap.add_argument("--dataset", required=True)
    ap.add_argument("--output_dir", required=True)
    ap.add_argument("--language", default="hi", help="XTTS language code: hi, ar, zh-cn, en ...")
    ap.add_argument("--epochs", type=int, default=6)
    ap.add_argument("--batch_size", type=int, default=2)
    ap.add_argument("--grad_accum", type=int, default=8)
    ap.add_argument("--learning_rate", type=float, default=5e-6)
    args = ap.parse_args()

    from trainer import Trainer, TrainerArgs
    from TTS.config.shared_configs import BaseDatasetConfig
    from TTS.tts.datasets import load_tts_samples
    from TTS.tts.layers.xtts.trainer.gpt_trainer import GPTArgs, GPTTrainer, GPTTrainerConfig, XttsAudioConfig

    md = args.model_dir
    need = {n: os.path.join(md, n) for n in ("model.pth", "config.json", "vocab.json", "dvae.pth", "mel_stats.pth")}
    missing = [n for n, p in need.items() if not os.path.exists(p)]
    if missing:
        say(f"[speech] ERROR: the XTTS-v2 base model is incomplete (missing {', '.join(missing)}). Download it from the page first.")
        sys.exit(1)
    ref = os.path.join(args.dataset, "reference.wav")
    os.makedirs(args.output_dir, exist_ok=True)

    dataset = BaseDatasetConfig(formatter="ljspeech", dataset_name="speech", path=args.dataset, meta_file_train="metadata.csv", language=args.language)
    model_args = GPTArgs(
        max_conditioning_length=132300, min_conditioning_length=66150, debug_loading_failures=False,
        max_wav_length=255995, max_text_length=200,
        mel_norm_file=need["mel_stats.pth"], dvae_checkpoint=need["dvae.pth"], xtts_checkpoint=need["model.pth"], tokenizer_file=need["vocab.json"],
        gpt_num_audio_tokens=1026, gpt_start_audio_token=1024, gpt_stop_audio_token=1025,
        gpt_use_masking_gt_prompt_approach=True, gpt_use_perceiver_resampler=True,
    )
    audio = XttsAudioConfig(sample_rate=22050, dvae_sample_rate=22050, output_sample_rate=24000)
    config = GPTTrainerConfig(
        epochs=args.epochs, output_path=args.output_dir, model_args=model_args, run_name="xtts_ft", project_name="speech",
        run_description="XTTS fine-tune from the Cursed_Ai Train Speech page", dashboard_logger="tensorboard", logger_uri=None,
        audio=audio, batch_size=args.batch_size, batch_group_size=48, eval_batch_size=args.batch_size, num_loader_workers=2,
        eval_split_max_size=64, eval_split_size=0.1, print_step=10, plot_step=100, log_model_step=1000,
        save_step=100000, save_n_checkpoints=1, save_checkpoints=True,
        optimizer="AdamW", optimizer_wd_only_on_weights=True, optimizer_params={"betas": [0.9, 0.96], "eps": 1e-8, "weight_decay": 1e-2},
        lr=args.learning_rate, lr_scheduler="MultiStepLR", lr_scheduler_params={"milestones": [50000 * 18, 150000 * 18, 300000 * 18], "gamma": 0.5, "last_epoch": -1},
        test_sentences=[],
    )
    model = GPTTrainer.init_from_config(config)
    train_samples, eval_samples = load_tts_samples([dataset], eval_split=True, eval_split_max_size=config.eval_split_max_size, eval_split_size=config.eval_split_size)
    say(f"[speech] {len(train_samples)} training clips, {len(eval_samples)} for checking")
    trainer = Trainer(TrainerArgs(restore_path=None, skip_train_epoch=False, start_with_eval=False, grad_accum_steps=args.grad_accum), config,
                      output_path=args.output_dir, model=model, train_samples=train_samples, eval_samples=eval_samples)
    say("[speech] starting training")
    trainer.fit()

    runs = sorted(glob.glob(os.path.join(args.output_dir, "xtts_ft-*")), key=os.path.getmtime)
    if not runs:
        say("[speech] ERROR: training finished but no run folder was found.")
        sys.exit(1)
    run = runs[-1]
    ckpt = os.path.join(run, "best_model.pth")
    if not os.path.exists(ckpt):
        found = sorted(glob.glob(os.path.join(run, "*.pth")), key=os.path.getmtime)
        ckpt = found[-1] if found else ""
    if not ckpt:
        say("[speech] ERROR: no checkpoint was written.")
        sys.exit(1)
    final = os.path.join(args.output_dir, "final")
    os.makedirs(final, exist_ok=True)
    shutil.copy(ckpt, os.path.join(final, "model.pth"))
    shutil.copy(os.path.join(run, "config.json"), os.path.join(final, "config.json"))
    shutil.copy(need["vocab.json"], os.path.join(final, "vocab.json"))
    if os.path.exists(ref):
        shutil.copy(ref, os.path.join(final, "reference.wav"))
    say(f"[speech] saved the voice model to {final}")
    say("[speech] done.")


if __name__ == "__main__":
    main()
