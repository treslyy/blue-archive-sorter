# 블루 아카이브 캐릭터 소트

한국어 블루 아카이브 캐릭터 비교·정렬 사이트입니다.

## GitHub Pages 배포
1. 저장소의 Settings → Pages로 이동합니다.
2. Build and deployment에서 Deploy from a branch를 선택합니다.
3. Branch는 `main`, 폴더는 `/(root)`로 설정하고 Save를 누릅니다.
4. 잠시 후 표시되는 GitHub Pages 주소로 접속합니다.

## 캐릭터 추가
`characters.json`의 `characters` 배열에 항목을 추가합니다.

```json
{
  "id": "yuuka",
  "name": "하야세 유우카",
  "school": "밀레니엄",
  "type": "student",
  "image": "images/yuuka.webp"
}
```

- `id`: 고유 식별자(중복 금지)
- `name`: 표시 이름
- `school`: 학교명(선택)
- `type`: `student`, `npc`, `mob` 중 하나
- `image`: 저장소 기준 이미지 경로(선택)
- 의상·버전 차이는 별도 캐릭터로 만들지 않습니다. 서로 다른 외형의 모브는 각각 등록합니다.

현재 명단은 비어 있습니다. 검증되지 않은 캐릭터 목록이나 이미지 주소를 임의로 포함하지 않았습니다.

## 저작권
소스 코드는 MIT License를 따릅니다. 게임 캐릭터와 게임 내 이미지의 권리는 각 권리자에게 있습니다.