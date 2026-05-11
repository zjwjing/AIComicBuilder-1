import { execSync, spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const py = "C:\\Users\\zjwji\\AppData\\Local\\Programs\\Python\\Python311\\python.exe";
const modelPath = "I:\\AIs\\Mano-P\\models\\Mininglamp\\Mano-P\\fp16";

const script = `
import torch, time, json
from transformers import AutoModelForVision2Seq, AutoProcessor
from PIL import Image, ImageDraw

model_path = ${JSON.stringify(modelPath)}
print(f"Loading model from {model_path}...")
start = time.time()

processor = AutoProcessor.from_pretrained(model_path)
model = AutoModelForVision2Seq.from_pretrained(
    model_path, torch_dtype=torch.bfloat16, device_map="auto",
    trust_remote_code=True,
).eval()

elapsed = time.time() - start
print(f"Model loaded in {elapsed:.0f}s")
print(f"Model type: {type(model).__name__}")
if hasattr(model, 'language_model'):
    print(f"LM params: {sum(p.numel() for p in model.language_model.parameters())/1e9:.2f}B")
print(f"Total params: {sum(p.numel() for p in model.parameters())/1e9:.2f}B")

# Quick test
img = Image.new('RGB', (1024, 768), color=(240, 240, 240))
draw = ImageDraw.Draw(img)
draw.rectangle([100, 100, 300, 200], fill=(0, 120, 255))
draw.rectangle([400, 100, 600, 200], fill=(255, 255, 255), outline=(200,200,200))

messages = [
    {"role": "user", "content": [
        {"type": "image", "image": img},
        {"type": "text", "text": "Describe what you see in this screen. What UI elements are visible?"}
    ]}
]
prompt = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
inputs = processor(text=[prompt], images=[img], padding=True, return_tensors="pt")
inputs = {k: v.to("cuda") if hasattr(v, 'to') else v for k, v in inputs.items()}

print("Generating...")
gen_start = time.time()
with torch.no_grad():
    generated_ids = model.generate(**inputs, max_new_tokens=128, do_sample=True, temperature=0.7)
gen_elapsed = time.time() - gen_start
output_text = processor.decode(generated_ids[0][inputs['input_ids'].shape[1]:], skip_special_tokens=True)
print(f"Generated in {gen_elapsed:.1f}s")
print(f"Response: {output_text[:300]}")
`;

try {
  console.log("Running Mano-P test...");
  const result = execSync(`"${py}" -c "${script.replace(/"/g, '\\"')}"`, {
    timeout: 180000,
    encoding: "utf-8",
    maxBuffer: 50 * 1024 * 1024,
  });
  console.log(result);
} catch (err) {
  console.error("FAILED:", err.message);
  if (err.stdout) console.log("STDOUT:", err.stdout);
  if (err.stderr) console.log("STDERR:", err.stderr);
}
