/** Ignore furniture ratios and supplementary named roles when a separate total is stated. */
export function withoutNonTotalHeadcounts(text:string):string {
  const number='(?:\\d+|[零〇一二两三四五六七八九十百千]+)';
  const pattern=new RegExp(`(?:每)?${number}\\s*(?:人|位|名)\\s*(?:(?:配|用|坐|共享|共用|各有|各)\\s*)?(?:${number}\\s*(?:套|张|把|桌|椅|份|组)|[/／]\\s*(?:桌|套|组))`,'g');
  const deskFirst=new RegExp(`(?:每桌|每张(?:课|长条|长|圆|方)?桌(?:子)?|(?:一|1)(?:张)?(?:课|长条|长|圆|方)?桌(?:子)?)(?:坐|供|配|安排|容纳)?${number}(?:个)?(?:人|位|名)`,'g');
  // “2人每桌” is a seating ratio, not attendance. If another count
  // immediately follows 每桌, however, it belongs to that desk instead:
  // “30人每桌2人” means 30 attendees and 2 per desk.
  const peopleFirst=new RegExp(`${number}\\s*(?:人|位|名)\\s*每\\s*(?:张\\s*)?(?:课|长条|长|圆|方)?桌(?:子)?(?!\\s*(?:坐|供|配|安排|容纳)?\\s*${number}\\s*(?:个\\s*)?(?:人|位|名))`,'g');
  const clean=text.replace(peopleFirst,' ').replace(pattern,' ').replace(deskFirst,' ');
  const role='(?:工作人员|服务人员|主持人|主讲人|演讲人|讲师|供应商|志愿者)';
  const roleCount=new RegExp(`(?:${number}\\s*(?:人|位|名)\\s*${role}|${role}\\s*${number}\\s*(?:人|位|名))`,'g');
  const withoutRoles=clean.replace(roleCount,' ');
  return new RegExp(`${number}\\s*(?:人|位|名)`).test(withoutRoles)?withoutRoles:clean;
}
