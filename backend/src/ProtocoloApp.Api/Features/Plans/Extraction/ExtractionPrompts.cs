using System.Globalization;
using System.Text;

namespace ProtocoloApp.Api.Features.Plans.Extraction;

/// <summary>Prompts sent with the PDF. The model's instructions are in Portuguese because the PDFs are.</summary>
internal static class ExtractionPrompts
{
    public static string Build(PlanKind kind, DateOnly today, IReadOnlyList<ExerciseHint> knownExercises)
    {
        var text = new StringBuilder();
        text.AppendLine(kind == PlanKind.Protocol
            ? "Extraia o PROTOCOLO (dieta, suplementos, compostos, cardio e orientações) do PDF anexo e envie chamando a ferramenta submit_protocol."
            : "Extraia a FICHA DE TREINO do PDF anexo e envie chamando a ferramenta submit_workout.");
        text.AppendLine();
        text.AppendLine(CultureInfo.InvariantCulture, $"Hoje é {today:yyyy-MM-dd}.");
        text.AppendLine();
        text.AppendLine("Regras gerais:");
        text.AppendLine("- Copie doses, quantidades e textos literalmente, como texto. Nunca invente números nem complete o que o PDF não diz; use null.");
        text.AppendLine("- Datas no formato yyyy-MM-dd. Quando o PDF omitir o ano, use a próxima ocorrência da data a partir de hoje e inclua o caminho do campo em lowConfidence.");
        text.AppendLine("- Liste em lowConfidence os caminhos de tudo o que estiver ilegível, ambíguo ou inferido. Os caminhos são relativos à raiz de document, com índices começando em 0 e sem prefixo (por exemplo items[2].doseText ou days[0].exercises[3].sets, nunca document.items[2]).");

        if (kind == PlanKind.Protocol)
        {
            text.AppendLine("- Chaves: refeições \"meal_1\", \"meal_2\", ...; itens do protocolo \"it_1\", \"it_2\", ...");
            text.AppendLine("- Escolha category e timing apenas entre os valores permitidos pela ferramenta. Para itens ligados a uma refeição use timing \"with_meal:<chave da refeição>\".");
            text.AppendLine("- schedule: \"daily\" quando o item é diário; \"weekdays\" com os dias (mon..sun); \"every_n_days\" com n e, se o PDF der a data de início, anchor.");
            text.AppendLine("- Se o PDF não trouxer a data da próxima atualização, deixe updateDate como null.");
        }
        else
        {
            text.AppendLine("- Chaves: dias \"A\", \"B\", \"C\", ...; exercícios \"A1\", \"A2\", ... (letra do dia + posição).");
            text.AppendLine("- rotation: copie a rotação como está no PDF. DESCANSO vira \"off\". Os valores da rotação devem ser chaves de dias existentes ou \"off\".");
            text.AppendLine("- Séries: gere um item em sets por série. \"5x 7 a 9\" vira cinco séries com repsMin 7 e repsMax 9. \"(1x14 a 16) (1x9 a 11) (1x4 a 6 + drop)\" vira três séries, a última com technique \"drop\".");
            text.AppendLine("- Intervalos de descanso: restSeconds para um valor único; restSequence para listas de intervalos (estilo SST), em segundos.");
            text.AppendLine("- Bi-sets: preencha supersetWith com a chave do outro exercício.");
            text.AppendLine("- Técnicas (opcional): em techniques use drop (count, sets \"last\"|\"all\"), rest_pause (count), biset (with), sst (rests), peak/isometric/zero_point (seconds), partials, progressive_load, stretch_interval; nas séries, drops e restPause. O texto que sobrar fica em technique.");
            text.AppendLine("- Quando o nome do exercício casar com um de knownExercises (ignorando acentos, maiúsculas, pontuação e \"c/\"/\"com\"), use o exerciseId dele. Caso contrário deixe exerciseId null e inclua o exercício em newExercises com o grupo muscular sugerido.");
            text.AppendLine();
            text.AppendLine("knownExercises (id | nome | grupo):");
            if (knownExercises.Count == 0)
            {
                text.AppendLine("(nenhum)");
            }
            else
            {
                foreach (var hint in knownExercises)
                    text.AppendLine(CultureInfo.InvariantCulture, $"{hint.Id} | {hint.Name} | {EnumText.ToText(hint.Group)}");
            }
        }

        return text.ToString();
    }
}
