export function validParticipantCpf(value: string): boolean {
  if (!/^\d{11}$/.test(value) || /^(\d)\1{10}$/.test(value)) return false;
  for (const length of [9, 10]) {
    let sum = 0;
    for (let index = 0; index < length; index++)
      sum += Number(value[index]) * (length + 1 - index);
    const check = (sum * 10) % 11;
    if ((check === 10 ? 0 : check) !== Number(value[length])) return false;
  }
  return true;
}
